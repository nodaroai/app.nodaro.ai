import { DOWNLOAD_TIMEOUT_MS } from "../providers/video/ffmpeg-timeouts.js"
import { probeLinkRefusal, type ProbeLinkRefusalCode } from "../providers/video/probe-guard.js"
import { PRE_CHARGE_PROBE_TIMEOUT_MS } from "./pre-charge-probe-bounds.js"
import { aiAvatarCreditIdOf } from "./probed-credit-ids.js"
import { safeUrlSchema } from "./url-validator.js"
import { probeSoundLengthSec } from "./video-utility-probe.js"

/**
 * AI Avatar in audio mode: how long the driving audio is, and so which
 * duration bucket a run holds (`aiAvatarCreditIdOf`, up to the 600-second
 * bucket; the worker trims a longer audio to 600 s). One rule for both places
 * a run starts — the route's preHandler (`POST /v1/ai-avatar`) and the
 * workflow run (node-executor, {@link stampAiAvatarAudioLength}) — so the same
 * audio is held the same wherever it runs. Before the workflow run measured
 * it, a workflow, app or template run held the 120-second default for any
 * audio, whatever its length.
 *
 * The sound's length is read as Trim reads a clip (`probeSoundLengthSec`,
 * through the probe guard): from the header, and for a recording whose header
 * carries none (a WebM a browser recorded) from its last audio packet,
 * streamed — a route within its deadline, the workflow run within the
 * render's own download bound. A probe that FAILS refuses the run before
 * anything is held: a host that could not be looked up for now, or a read
 * that ran out of time, is the retryable 503 every measuring route answers
 * (`probeLinkRefusal`); a link that is not an ordinary media file, or audio
 * that cannot be read, is a 400 (`invalid_media_duration`).
 */
export type AiAvatarAudioLength =
  | { readonly ok: true; /** The whole seconds measured; absent for a file with no positive length (the 120-second default). */ readonly sec?: number }
  | { readonly ok: false; readonly code: "invalid_media_duration" | ProbeLinkRefusalCode; readonly message: string }

const UNREADABLE = {
  code: "invalid_media_duration",
  message: "Could not read the audio's length. The file may be corrupted or an unsupported format.",
} as const

export async function measureAiAvatarAudio(
  audioUrl: string,
  /** A route's deadline for the whole measure (its client is waiting); without one the packet scan gets the download bound. */
  bounds: { readonly deadlineAt?: number } = {},
  onProbeFailure: (err: unknown) => void = () => {},
): Promise<AiAvatarAudioLength> {
  let duration: number
  try {
    duration = await probeSoundLengthSec(audioUrl, {
      timeoutMs: PRE_CHARGE_PROBE_TIMEOUT_MS,
      ...(bounds.deadlineAt !== undefined ? { deadlineAt: bounds.deadlineAt } : { packetTimeoutMs: DOWNLOAD_TIMEOUT_MS }),
    })
  } catch (err) {
    onProbeFailure(err)
    return { ok: false, ...(probeLinkRefusal(err) ?? UNREADABLE) }
  }
  return Number.isFinite(duration) && duration > 0 ? { ok: true, sec: Math.ceil(duration) } : { ok: true }
}

/**
 * The workflow run's twin of the route's preHandler: measures an audio-mode
 * ai-avatar payload's audio and stamps `bucketKey` — the duration bucket the
 * run holds for it (see {@link aiAvatarReserveId}). The caller must run it
 * BEFORE writing input_data and before anything is reserved. Returns the
 * route's refusal for audio it would refuse; undefined otherwise, and for any
 * other job or a text-mode run, whose payload is left untouched.
 */
export async function stampAiAvatarAudioLength(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  if (jobName !== "ai-avatar" || payload.speechMode !== "audio") return undefined
  const audioUrl = typeof payload.audioUrl === "string" ? payload.audioUrl : ""
  // Raw workflow JSON reaches here without the route's Zod: only an http(s) link to a public host is probed.
  if (!safeUrlSchema.safeParse(audioUrl).success) return UNREADABLE
  const measured = await measureAiAvatarAudio(audioUrl, {}, (err) => {
    console.warn("[node-executor] ai-avatar: audio probe failed; refusing the run:", err)
  })
  if (!measured.ok) return { code: measured.code, message: measured.message }
  payload.bucketKey = aiAvatarCreditIdOf(payload, measured.sec)
  return undefined
}

/** The duration bucket a stamped ai-avatar payload holds; undefined for any other job (and a text-mode run: its build's own id). */
export function aiAvatarReserveId(jobName: string, payload: Record<string, unknown>): string | undefined {
  return jobName === "ai-avatar" && typeof payload.bucketKey === "string" ? payload.bucketKey : undefined
}
