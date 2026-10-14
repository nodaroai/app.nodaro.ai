import { PITCH_TEMPO_PRICING, pitchTempoCreditId } from "@nodaro/shared/credits"
import { probeMediaDuration } from "../providers/video/ffmpeg-utils.js"

/**
 * Pitch & Tempo: how long the input media is, and so which per-minute id a run
 * reserves (`pitch-tempo:<N>m`).
 *
 * One rule for both places a run starts — the route's preHandler
 * (`POST /v1/pitch-tempo`) and the workflow run (node-executor) — so the same
 * input costs the same wherever it runs.
 *
 * Unlike Video SFX there is NO fallback length (decided 2026-10-12): a length
 * that cannot be read is refused before anything is charged, and so is one over
 * the 30-minute cap.
 */
export type PitchTempoDuration =
  | { readonly ok: true; readonly durationSec: number; readonly creditId: string }
  | {
      readonly ok: false
      readonly code: "invalid_media_duration" | "media_duration_exceeds_limit"
      readonly message: string
    }

export async function measurePitchTempoDuration(
  mediaUrl: string,
  onProbeFailure: (err: unknown) => void = () => {},
): Promise<PitchTempoDuration> {
  let seconds: number
  try {
    seconds = await probeMediaDuration(mediaUrl)
  } catch (err) {
    onProbeFailure(err)
    return {
      ok: false,
      code: "invalid_media_duration",
      message: "Couldn't read the length of the input media. The file may be unreachable, corrupted or in an unsupported format.",
    }
  }
  if (seconds > PITCH_TEMPO_PRICING.MAX_DURATION_SEC) {
    return {
      ok: false,
      code: "media_duration_exceeds_limit",
      message:
        `The input is ${Math.ceil(seconds)} seconds long. Pitch & Tempo accepts up to ` +
        `${PITCH_TEMPO_PRICING.MAX_DURATION_SEC} seconds (30 minutes).`,
    }
  }
  return { ok: true, durationSec: seconds, creditId: pitchTempoCreditId(seconds) }
}

/** The media a pitch-tempo payload names (a video takes precedence, as in the engine). */
function payloadMediaUrl(payload: Record<string, unknown>): string {
  const pick = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined)
  return pick(payload.videoUrl) ?? pick(payload.audioUrl) ?? ""
}

/**
 * The workflow run's twin of the route's preHandler: measures a pitch-tempo
 * payload's media and stamps `duration_seconds` and `bucketKey` (the id the run
 * reserves, see `pitchTempoReserveId`). The caller must run it BEFORE writing
 * input_data. Returns the route's refusal for media it would refuse; undefined
 * otherwise, and for any other job, whose payload is left untouched.
 */
export async function stampPitchTempoDuration(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  if (jobName !== "pitch-tempo") return undefined
  const measured = await measurePitchTempoDuration(payloadMediaUrl(payload), (err) => {
    console.warn("[node-executor] pitch-tempo: ffprobe failed; refusing the run:", err)
  })
  if (!measured.ok) return { code: measured.code, message: measured.message }
  payload.duration_seconds = measured.durationSec
  payload.bucketKey = measured.creditId
  return undefined
}

/** The id a stamped pitch-tempo payload reserves; undefined for any other job. */
export function pitchTempoReserveId(jobName: string, payload: Record<string, unknown>): string | undefined {
  return jobName === "pitch-tempo" && typeof payload.bucketKey === "string" ? payload.bucketKey : undefined
}
