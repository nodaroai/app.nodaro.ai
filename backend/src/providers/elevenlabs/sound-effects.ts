import { ELEVENLABS_BASE_URL, getElevenLabsHeaders } from "./client.js"
import { providerFetch, type EgressMeta } from "../egress.js"
import { hasCredits } from "../../lib/config.js"

/**
 * ElevenLabs Sound Effects, called DIRECTLY (POST /v1/sound-generation).
 *
 * WHY: `elevenlabs-sfx` used to run through KIE's `elevenlabs/sound-effect-v2`
 * wrapper. In October 2026 that wrapper started answering every request with
 * a 500 after ~34 s and disappeared from KIE's docs, with no change on our
 * side. Text-to-speech, dialogue, STT, voice design and voice changer had
 * already moved to the direct ElevenLabs API for the same family of reasons;
 * this is the last ElevenLabs model that went through the proxy.
 *
 * The call is synchronous: ElevenLabs answers with the finished audio (mp3)
 * in the response body. There is no task id to persist and nothing for the
 * reconcile cron to re-fetch, so this funnel returns bytes and the caller
 * stores them.
 *
 * The provider id stays `elevenlabs-sfx` — saved workflows, presets, the MCP
 * tool and the public API all keep sending it.
 */

/** The only sound-effect model ElevenLabs offers on this endpoint. */
export const SOUND_EFFECT_MODEL = "eleven_text_to_sound_v2"

/** ElevenLabs' own bounds for `duration_seconds`. */
export const SOUND_EFFECT_MIN_DURATION_SEC = 0.5
export const SOUND_EFFECT_MAX_DURATION_SEC = 30

// Generation takes seconds; the bound is for a stalled connection, so a hung
// request can never hold a worker slot until undici's implicit limit.
const SOUND_EFFECT_TIMEOUT_MS = 120_000

const CONTEXT = "Sound effect generation"

export interface SoundEffectOptions {
  /** Seconds, 0.5–30. Omitted → ElevenLabs picks a length from the prompt. */
  duration?: number
  /** Ask for a seamlessly looping clip. */
  loop?: boolean
  /** 0–1: how literally the prompt is followed. */
  promptInfluence?: number
}

/**
 * A failed sound-effect request.
 *
 * `message` is what the user sees — it never names the vendor or echoes its
 * response. `internalDetails` is the raw status + body for the operator; it is
 * the duck-typed field `lib/provider-error-detail.ts :: providerDetailOf`
 * reads into `jobs.error_detail` (redacted there), the same shape `KieError`
 * and `ReplicateSanitizedError` carry.
 *
 * `deterministic` is the marker `lib/deterministic-job-error.ts ::
 * isDeterministicJobError` reads: a 400/422 is a refusal of these exact
 * inputs, so the worker fails the job now instead of re-sending the same
 * request on every queue attempt. Everything else (429, 5xx, timeouts, our
 * key) can succeed later and stays retryable.
 */
export class SoundEffectError extends Error {
  readonly internalDetails: string
  readonly status: number | null
  readonly deterministic: boolean

  constructor(message: string, internalDetails: string, status: number | null, deterministic = false) {
    super(message)
    this.name = "SoundEffectError"
    this.internalDetails = internalDetails
    this.status = status
    this.deterministic = deterministic
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Status + body → the sentence a user can act on. The sentences are the ones
 * `providers/kie/client.ts :: createSanitizedError` already emits for the same
 * situations, so `lib/mcp/tools/_job-error.ts` classifies them the same way
 * (a 400/422 reads as non-retryable through "rejected these settings").
 */
export function soundEffectFailure(status: number, body: string): SoundEffectError {
  const internal = `[sound-generation ${status}] ${body}`.slice(0, 2000)
  const lower = body.toLowerCase()
  // One line with the provider's own words: the worker logs only the
  // sanitized sentence for this class, and Railway's single-line search is
  // where a prod failure gets diagnosed first.
  console.error(`[elevenlabs sfx] ${status}: ${body.replace(/\s+/g, " ").slice(0, 500)}`)

  // OUR account is out of quota — nothing to do with the user's credits (the
  // worker refunds those). Greppable marker so a drained balance is visible in
  // the logs at a glance, as the KIE balance branch does.
  if (lower.includes("quota_exceeded") || lower.includes("insufficient")) {
    console.error(`[ALERT] sound-effect provider quota exhausted — top up required (status ${status})`)
    return new SoundEffectError(
      "The generation service is temporarily out of capacity on our side — your credits were not charged. Please try again later or contact support.",
      internal,
      status,
    )
  }
  if (status === 401 || status === 403) {
    // Our key, not the user's input. Cloud: ours to fix. Self-host: the
    // operator's own key was refused, and they are the one who can fix it.
    return new SoundEffectError(
      hasCredits()
        ? "Service is not properly configured. Please contact support."
        : "Sound effects: the configured ELEVENLABS_API_KEY was refused. Check it in Install health → Provider keys.",
      internal,
      status,
    )
  }
  if (status === 429) {
    return new SoundEffectError("Service is temporarily busy. Please try again in a moment.", internal, status)
  }
  if (status === 400 || status === 422) {
    return new SoundEffectError(
      `${CONTEXT} failed: the provider rejected these settings for this model. ` +
        "Retrying the same request will fail again — change the prompt, duration, loop or prompt influence and try again.",
      internal,
      status,
      true,
    )
  }
  return new SoundEffectError(
    `${CONTEXT} failed. Please try again or contact support if the issue persists.`,
    internal,
    status,
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** The request body, exactly as it goes on the wire. Exported for tests. */
export function buildSoundEffectBody(text: string, options?: SoundEffectOptions): Record<string, unknown> {
  const body: Record<string, unknown> = { text, model_id: SOUND_EFFECT_MODEL }
  // Only when set: an omitted duration is ElevenLabs' auto-length mode, which
  // a default value here would silently turn off.
  if (options?.duration != null && Number.isFinite(options.duration)) {
    body.duration_seconds = clamp(options.duration, SOUND_EFFECT_MIN_DURATION_SEC, SOUND_EFFECT_MAX_DURATION_SEC)
  }
  if (options?.loop != null) body.loop = options.loop
  if (options?.promptInfluence != null && Number.isFinite(options.promptInfluence)) {
    body.prompt_influence = clamp(options.promptInfluence, 0, 1)
  }
  return body
}

/**
 * Generate one sound effect and return its mp3 bytes.
 *
 * Throws `MissingProviderKeyError` (via `getElevenLabsHeaders`) when no key is
 * configured, before any request leaves — the one missing-key phrasing every
 * provider shares.
 */
export async function generateSoundEffect(
  text: string,
  options?: SoundEffectOptions,
  meta?: EgressMeta,
): Promise<Buffer> {
  const headers = getElevenLabsHeaders()
  const body = buildSoundEffectBody(text, options)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SOUND_EFFECT_TIMEOUT_MS)
  let response: Response
  try {
    response = await providerFetch(
      {
        provider: "elevenlabs",
        operation: "soundEffects",
        // Single-purpose funnel → default OUR key inside (the worker passes no
        // meta). Same id the route reserves credits under.
        modelKey: meta?.modelKey ?? "elevenlabs-sfx",
        body,
        dimensions: meta?.dimensions ?? {
          ...(body.duration_seconds != null ? { duration: body.duration_seconds as number } : { durationLabel: "auto" }),
          ...(body.loop != null ? { loop: body.loop as boolean } : {}),
        },
      },
      `${ELEVENLABS_BASE_URL}/v1/sound-generation`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    )
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[elevenlabs sfx] request failed${controller.signal.aborted ? " (timeout)" : ""}: ${detail}`)
    if (controller.signal.aborted) {
      throw new SoundEffectError(
        "Generation timed out. Please try again.",
        `[sound-generation] timed out after ${SOUND_EFFECT_TIMEOUT_MS / 1000}s`,
        null,
      )
    }
    throw new SoundEffectError(
      `${CONTEXT} failed. Please try again or contact support if the issue persists.`,
      `[sound-generation] request failed: ${detail}`,
      null,
    )
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw soundEffectFailure(response.status, errorText)
  }

  const audio = Buffer.from(await response.arrayBuffer())
  if (audio.byteLength === 0) {
    throw new SoundEffectError(
      `${CONTEXT} failed. Please try again or contact support if the issue persists.`,
      "[sound-generation] 200 with an empty body",
      response.status,
    )
  }
  return audio
}
