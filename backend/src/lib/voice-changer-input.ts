import { VOICE_CHANGER_RATE_ID, checkVoiceChangerLength } from "@nodaro/shared/credits"
import { DOWNLOAD_TIMEOUT_MS } from "../providers/video/ffmpeg-timeouts.js"
import { probeLinkRefusal, type ProbeLinkRefusalCode } from "../providers/video/probe-guard.js"
import { unitRateBaseCredits } from "./credit-base-cost.js"
import { PRE_CHARGE_PROBE_TIMEOUT_MS } from "./pre-charge-probe-bounds.js"
import { safeUrlSchema } from "./url-validator.js"
import { probeSoundLengthSec } from "./video-utility-probe.js"

/**
 * Voice Changer input gate (decided 2026-11-22): reads the length of the audio
 * before anything is held, refuses audio past the 5-minute cap, and prices the
 * run from that length — one `elevenlabs-voice-changer:per-10s` unit per
 * started ten seconds (`checkVoiceChangerLength`, @nodaro/shared). A length the
 * caller declares is never read.
 *
 * The file read is the one the run revoices: the video when the run is given
 * one (a video wins, as the worker does), else the audio
 * ({@link voiceChangerSourceUrl}).
 *
 * CORE, deliberately not `ee/`: input validation runs in every edition. One
 * rule for both places a run starts — the route's step inside the credit
 * guard (`beforePricing`, so a refusal is a 400 with nothing held) and the
 * workflow run's stamp (before input_data is written or anything reserved).
 *
 * The length is the sound's, read as Audio Isolation reads its audio
 * (`probeSoundLengthSec`, through the probe guard): from the header, and for a
 * recording whose header carries none (a WebM a browser recorded) from its
 * last audio packet. A video file gives its container's length. A read that
 * fails refuses the run, never prices a guess: a host that could not be looked
 * up for now, or a read that ran out of time, is the retryable 503 every such
 * route answers (`probeLinkRefusal`); a file that cannot be read, or that has
 * no sound track to revoice, is a 400. The worker reads the length again from
 * the audio it sends, by the same reader, and refuses audio that would cost
 * more than the run holds (`voice-changer-run.ts`).
 */
export type VoiceChangerInput =
  | {
      readonly ok: true
      /** The audio's length in seconds, as read. */
      readonly audioSec: number
      /** Units of `VOICE_CHANGER_RATE_ID` the run is held and charged. */
      readonly units: number
    }
  | {
      readonly ok: false
      readonly code: "audio_too_long" | "audio_unreadable" | ProbeLinkRefusalCode
      readonly message: string
    }

export const VOICE_CHANGER_UNREADABLE_MESSAGE =
  "Couldn't read the length of the audio. Check that the link is a reachable audio (or video) file in a common format."

export const VOICE_CHANGER_NO_AUDIO_MESSAGE =
  "This file has no audio track to revoice. Use a clip with spoken audio (e.g. a Veo 3 / lip-synced video), or feed audio directly."

/** A non-empty string, else undefined. */
function linkOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

/**
 * The link a Voice Changer run is priced on and revoices: the video when it is
 * given one (a video wins, as the route documents and the worker does), else
 * the audio; undefined when it is given neither.
 */
export function voiceChangerSourceUrl(body: { readonly audioUrl?: unknown; readonly videoUrl?: unknown }): string | undefined {
  return linkOf(body.videoUrl) ?? linkOf(body.audioUrl)
}

/** Whether a failed read found the file has no audio stream at all (the reader's `ClipUnreadableError`). */
function hasNoAudioStream(err: unknown): boolean {
  let e: unknown = err
  for (let depth = 0; e !== null && typeof e === "object" && depth < 5; depth++) {
    const f = e as { name?: unknown; message?: unknown; cause?: unknown }
    if (f.name === "ClipUnreadableError" && typeof f.message === "string" && /no audio stream/.test(f.message)) return true
    e = f.cause
  }
  return false
}

export async function readVoiceChangerInput(
  sourceUrl: string,
  onProbeFailure: (err: unknown) => void = () => {},
  /** A route's deadline for the whole read (its client is waiting); without one the packet scan gets the download bound. */
  bounds: { readonly deadlineAt?: number } = {},
): Promise<VoiceChangerInput> {
  let seconds: number
  try {
    seconds = await probeSoundLengthSec(sourceUrl, {
      timeoutMs: PRE_CHARGE_PROBE_TIMEOUT_MS,
      ...(bounds.deadlineAt !== undefined ? { deadlineAt: bounds.deadlineAt } : { packetTimeoutMs: DOWNLOAD_TIMEOUT_MS }),
    })
  } catch (err) {
    onProbeFailure(err)
    const refused = probeLinkRefusal(err)
    if (refused) return { ok: false, ...refused }
    if (hasNoAudioStream(err)) return { ok: false, code: "audio_unreadable", message: VOICE_CHANGER_NO_AUDIO_MESSAGE }
    return { ok: false, code: "audio_unreadable", message: VOICE_CHANGER_UNREADABLE_MESSAGE }
  }
  if (!(seconds > 0) || !Number.isFinite(seconds)) {
    return { ok: false, code: "audio_unreadable", message: VOICE_CHANGER_UNREADABLE_MESSAGE }
  }
  const length = checkVoiceChangerLength(seconds)
  if (!length.ok) return { ok: false, code: length.code, message: length.message }
  return { ok: true, audioSec: seconds, units: length.units }
}

/** Payload fields only the stamp may set: dropped from every voice-changer payload first. */
const STAMPED_FIELDS = ["voiceChangerSec", "voiceChangerUnits"] as const

/**
 * The workflow run's twin of the route's step: reads a voice-changer payload's
 * audio (its video when it carries one) by the same rule, refuses what the
 * route refuses, and stamps what the route records — `voiceChangerSec` (the
 * length read) and `voiceChangerUnits` (the units held and charged). The
 * caller must run it BEFORE writing input_data: the worker reads the jobs row.
 * The link must pass the route's own `safeUrlSchema` first: raw workflow JSON
 * reaches here without the route's Zod. Undefined for any other job.
 */
export async function stampVoiceChangerInput(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  if (jobName !== "voice-changer") return undefined
  for (const key of STAMPED_FIELDS) delete payload[key]
  const sourceUrl = voiceChangerSourceUrl(payload) ?? ""
  if (!safeUrlSchema.safeParse(sourceUrl).success) return { code: "audio_unreadable", message: VOICE_CHANGER_UNREADABLE_MESSAGE }
  const read = await readVoiceChangerInput(sourceUrl, (err) => {
    console.warn("[node-executor] voice-changer: the audio's length could not be read; refusing the run:", err)
  })
  if (!read.ok) return { code: read.code, message: read.message }
  payload.voiceChangerSec = read.audioSec
  payload.voiceChangerUnits = read.units
  return undefined
}

/** The row a stamped voice-changer payload reserves; undefined for any other job. */
export function voiceChangerReserveId(jobName: string, payload: Record<string, unknown>): string | undefined {
  return jobName === "voice-changer" && typeof payload.voiceChangerUnits === "number" ? VOICE_CHANGER_RATE_ID : undefined
}

/**
 * BASE credits of a stamped voice-changer payload: the per-10-second row ×
 * its units, rounded up once (what the route's guard charges for the same
 * audio); undefined for any other job. A run that reached here without its
 * length is refused, never priced at a guess.
 */
export async function voiceChangerStampedBaseCredits(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<number | undefined> {
  if (jobName !== "voice-changer") return undefined
  const units = payload.voiceChangerUnits
  if (typeof units !== "number" || !(units > 0)) {
    throw new Error("voice-changer: the run reached its reservation without the length of its audio")
  }
  return unitRateBaseCredits(VOICE_CHANGER_RATE_ID, units)
}
