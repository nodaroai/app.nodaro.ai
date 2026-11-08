/**
 * What the Voice Library said about each voice this deployment's library
 * listing served, kept so the voice lock can place a library voice by its id
 * alone.
 *
 * The ElevenLabs shared-voices API filters by gender, name and so on, but has
 * no lookup by voice id, so at use time (text-to-speech, dialogue, a plugin's
 * voice conversion) nothing can be asked what a library id is. The listing
 * (`GET /v1/voices/library`, `routes/voices.ts`) is the one place the
 * platform sees the library's own gender for a voice, so it writes it here,
 * and the lock's resolver (`lib/voice-gender.ts`) reads it. Redis, not process
 * memory: the API process writes, the orchestrator reads.
 *
 * Written only while a voice lock is set, for every served voice whose gender
 * the library states (allowed or not, so a later change of the lock is judged
 * right). A voice never served while locked has no record: it is unknown, and
 * the lock refuses it.
 */
import { redis } from "./queue-connection.js"
import { knownVoiceGender, voiceLockActive, type VoiceGender } from "./voice-policy.js"

export const LIBRARY_VOICE_GENDER_KEY_PREFIX = "voice-gender:library:"

/** A voice's gender does not change; every listing that serves the voice refreshes its record. */
const RECORD_TTL_SECONDS = 180 * 24 * 60 * 60

/** An ElevenLabs voice id. Anything else is never written or looked up. */
const VOICE_ID = /^[A-Za-z0-9_-]{1,64}$/

export async function recordLibraryVoiceGenders(
  voices: ReadonlyArray<{ readonly voice_id: string; readonly gender?: string | null }>,
): Promise<void> {
  if (!voiceLockActive()) return
  const writes: Array<readonly [string, VoiceGender]> = []
  for (const v of voices) {
    const g = knownVoiceGender(v.gender)
    if (g !== undefined && VOICE_ID.test(v.voice_id)) writes.push([v.voice_id, g])
  }
  if (writes.length === 0) return
  const pipeline = redis.pipeline()
  for (const [voiceId, g] of writes) pipeline.set(`${LIBRARY_VOICE_GENDER_KEY_PREFIX}${voiceId}`, g, "EX", RECORD_TTL_SECONDS)
  // A pipeline reports each command's error in its results instead of throwing.
  const failed = (await pipeline.exec())?.find(([err]) => err)
  if (failed) throw failed[0]
}

/** The gender the library stated for `voiceId` when this deployment listed it, or undefined. */
export async function recordedLibraryVoiceGender(voiceId: string): Promise<VoiceGender | undefined> {
  if (!VOICE_ID.test(voiceId)) return undefined
  return knownVoiceGender(await redis.get(`${LIBRARY_VOICE_GENDER_KEY_PREFIX}${voiceId}`))
}
