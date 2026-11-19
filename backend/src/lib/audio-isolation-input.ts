import { AUDIO_ISOLATION_RATE_ID, checkAudioIsolationLength } from "@nodaro/shared/credits"
import { DOWNLOAD_TIMEOUT_MS } from "../providers/video/ffmpeg-timeouts.js"
import { probeLinkRefusal, type ProbeLinkRefusalCode } from "../providers/video/probe-guard.js"
import { unitRateBaseCredits } from "./credit-base-cost.js"
import { PRE_CHARGE_PROBE_TIMEOUT_MS } from "./pre-charge-probe-bounds.js"
import { safeUrlSchema } from "./url-validator.js"
import { probeSoundLengthSec } from "./video-utility-probe.js"

/**
 * Audio Isolation input gate (decided 2026-11-18): reads the length of the
 * audio before anything is held, refuses audio past the 30-minute cap, and
 * prices the run from that length — one `elevenlabs-isolation:per-10s` unit
 * per started ten seconds (`checkAudioIsolationLength`, @nodaro/shared). A
 * length the caller declares is never read.
 *
 * CORE, deliberately not `ee/`: input validation runs in every edition. One
 * rule for both places a run starts — the route's step inside the credit
 * guard (`beforePricing`, so a refusal is a 400 with nothing held) and the
 * workflow run's stamp (before input_data is written or anything reserved).
 *
 * The length is the sound's, read as AI Avatar reads its audio
 * (`probeSoundLengthSec`, through the probe guard): from the header, and for a
 * recording whose header carries none (a WebM a browser recorded) from its
 * last audio packet. A video file gives its container's length. A read that
 * fails refuses the run, never prices a guess: a host that could not be looked
 * up for now, or a read that ran out of time, is the retryable 503 every
 * such route answers (`probeLinkRefusal`); a file that cannot be read is a 400.
 * The worker reads the same length again from the copy it sends, by the same
 * reader, and refuses a copy that would cost more than the run holds.
 */
export type AudioIsolationInput =
  | {
      readonly ok: true
      /** The audio's length in seconds, as read. */
      readonly audioSec: number
      /** Units of `AUDIO_ISOLATION_RATE_ID` the run is held and charged. */
      readonly units: number
    }
  | {
      readonly ok: false
      readonly code: "audio_too_long" | "audio_unreadable" | ProbeLinkRefusalCode
      readonly message: string
    }

export const AUDIO_ISOLATION_UNREADABLE_MESSAGE =
  "Couldn't read the length of the audio. Check that the link is a reachable audio (or video) file in a common format."

export async function readAudioIsolationInput(
  audioUrl: string,
  onProbeFailure: (err: unknown) => void = () => {},
  /** A route's deadline for the whole read (its client is waiting); without one the packet scan gets the download bound. */
  bounds: { readonly deadlineAt?: number } = {},
): Promise<AudioIsolationInput> {
  let seconds: number
  try {
    seconds = await probeSoundLengthSec(audioUrl, {
      timeoutMs: PRE_CHARGE_PROBE_TIMEOUT_MS,
      ...(bounds.deadlineAt !== undefined ? { deadlineAt: bounds.deadlineAt } : { packetTimeoutMs: DOWNLOAD_TIMEOUT_MS }),
    })
  } catch (err) {
    onProbeFailure(err)
    const refused = probeLinkRefusal(err)
    if (refused) return { ok: false, ...refused }
    return { ok: false, code: "audio_unreadable", message: AUDIO_ISOLATION_UNREADABLE_MESSAGE }
  }
  if (!(seconds > 0) || !Number.isFinite(seconds)) {
    return { ok: false, code: "audio_unreadable", message: AUDIO_ISOLATION_UNREADABLE_MESSAGE }
  }
  const length = checkAudioIsolationLength(seconds)
  if (!length.ok) return { ok: false, code: length.code, message: length.message }
  return { ok: true, audioSec: seconds, units: length.units }
}

/** Payload fields only the stamp may set: dropped from every audio-isolation payload first. */
const STAMPED_FIELDS = ["audioIsolationSec", "audioIsolationUnits"] as const

/**
 * The workflow run's twin of the route's step: reads an audio-isolation
 * payload's audio by the same rule, refuses what the route refuses, and stamps
 * what the route records — `audioIsolationSec` (the length read) and
 * `audioIsolationUnits` (the units held and charged). The caller must run it
 * BEFORE writing input_data: the worker reads the jobs row. The audioUrl must
 * pass the route's own `safeUrlSchema` first: raw workflow JSON reaches here
 * without the route's Zod. Undefined for any other job.
 */
export async function stampAudioIsolationInput(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  if (jobName !== "audio-isolation") return undefined
  for (const key of STAMPED_FIELDS) delete payload[key]
  const audioUrl = typeof payload.audioUrl === "string" ? payload.audioUrl : ""
  if (!safeUrlSchema.safeParse(audioUrl).success) return { code: "audio_unreadable", message: AUDIO_ISOLATION_UNREADABLE_MESSAGE }
  const read = await readAudioIsolationInput(audioUrl, (err) => {
    console.warn("[node-executor] audio-isolation: the audio's length could not be read; refusing the run:", err)
  })
  if (!read.ok) return { code: read.code, message: read.message }
  payload.audioIsolationSec = read.audioSec
  payload.audioIsolationUnits = read.units
  return undefined
}

/** The row a stamped audio-isolation payload reserves; undefined for any other job. */
export function audioIsolationReserveId(jobName: string, payload: Record<string, unknown>): string | undefined {
  return jobName === "audio-isolation" && typeof payload.audioIsolationUnits === "number" ? AUDIO_ISOLATION_RATE_ID : undefined
}

/**
 * BASE credits of a stamped audio-isolation payload: the per-10-second row ×
 * its units, rounded up once (what the route's guard charges for the same
 * audio); undefined for any other job. A run that reached here without its
 * length is refused, never priced at a guess.
 */
export async function audioIsolationStampedBaseCredits(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<number | undefined> {
  if (jobName !== "audio-isolation") return undefined
  const units = payload.audioIsolationUnits
  if (typeof units !== "number" || !(units > 0)) {
    throw new Error("audio-isolation: the run reached its reservation without the length of its audio")
  }
  return unitRateBaseCredits(AUDIO_ISOLATION_RATE_ID, units)
}
