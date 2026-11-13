/**
 * The voice lock (B4c) for a lane that must not load the lock's resolver while
 * no lock is set: a speech worker's backstop (workers/handlers/audio-ai.ts,
 * video-ai.ts), a film-studio pipeline step (ee/pipelines/services) and the
 * voiced lane of `POST /v1/generate-video`. The verdict is the routes' own
 * (lib/voice-gender.ts: a voice judged by its id alone, unknown refused).
 *
 * With no lock these return before anything is loaded or read: the resolver
 * reaches Redis and the database (and the premade catalog's provider client),
 * so it is imported only once a lock is set and there is a voice to judge. The
 * modules that call this are imported by processes and tests that never touch
 * the lock.
 *
 * A lane with no reply to send asks `assertVoicesAllowed`, answered by a throw:
 * `VoiceNotAvailableError`, the lock's coded refusal, which the video worker
 * treats as final (the job is failed and refunded on this attempt, not retried).
 */
import { judgeUnnamedVoices, voiceLockActive, VoiceNotAvailableError, type VoiceVerdict } from "./voice-policy.js"
import type { VoiceLookup } from "./voice-gender.js"
import { ttsNamedVoices } from "@nodaro/shared/model-catalog"

const ALLOWED: VoiceVerdict = Object.freeze({ allowed: true })

/**
 * The lock's verdict for `voices`. Only non-empty strings are voices: an empty
 * one is the dispatch default, which is the policy's own (`defaultAllowedVoiceId`,
 * and the funnels' unnamed-voice default, `resolveDirectVoiceId`). No lock, or
 * no named voice: an allow, nothing loaded or read. A lookup that fails throws
 * as itself — a server error, never an allow and never a refusal that blames
 * the voice.
 */
export async function judgeVoicesUnderLock(voices: ReadonlyArray<unknown>, lookup: VoiceLookup): Promise<VoiceVerdict> {
  if (!voiceLockActive()) return ALLOWED
  const named = voices.filter((v): v is string => typeof v === "string" && v.length > 0)
  if (named.length === 0) return ALLOWED
  const { judgeVoices } = await import("./voice-gender.js")
  return judgeVoices(named, lookup)
}

/** Throws `VoiceNotAvailableError` when the lock refuses any of `voices` (`judgeVoicesUnderLock`). */
export async function assertVoicesAllowed(voices: ReadonlyArray<unknown>, lookup: VoiceLookup): Promise<void> {
  const verdict = await judgeVoicesUnderLock(voices, lookup)
  if (!verdict.allowed) throw new VoiceNotAvailableError(verdict.reason)
}

/**
 * The lock's answer for a speech model that speaks only its own named voices
 * (Gemini; `TtsCapabilities.voices`): the platform records no gender for
 * them, and a request that names no voice runs the model's default, so under
 * any lock the model is refused whole, whatever voice is named (decided
 * 2026-11-13) — as a voice of unknown gender. No lock, or any other model: an
 * allow.
 */
export function judgeNamedVoiceModel(provider: string | undefined): VoiceVerdict {
  return ttsNamedVoices(provider) ? judgeUnnamedVoices() : ALLOWED
}

/** Throws `VoiceNotAvailableError` when the lock refuses a named-voice model (`judgeNamedVoiceModel`). */
export function assertNamedVoiceModelAllowed(provider: string | undefined): void {
  const verdict = judgeNamedVoiceModel(provider)
  if (!verdict.allowed) throw new VoiceNotAvailableError(verdict.reason)
}

/**
 * Throws `VoiceNotAvailableError` (with `message`, the lane's own sentence)
 * under any lock, for speech whose voices nobody names — a dub
 * (`judgeUnnamedVoices`). No lock: returns.
 */
export function assertUnnamedVoicesAllowed(message: string): void {
  const verdict = judgeUnnamedVoices()
  if (!verdict.allowed) throw new VoiceNotAvailableError(verdict.reason, message)
}
