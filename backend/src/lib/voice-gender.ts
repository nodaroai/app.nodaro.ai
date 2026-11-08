/**
 * The voice lock's resolver (B4c): what the platform can VOUCH for about a
 * voice's gender, from the voice's id alone. A request's own `voiceType` is
 * never consulted: a library id sent as "premade" used to pass a check that
 * only knew premade voices.
 *
 * The sources, all server-side, in order:
 *   1. the premade catalog, by name or by voice id (`premadeCatalogGender`);
 *   2. the gender the Voice Library stated when this deployment's library
 *      listing served the voice (`lib/library-voice-genders.ts`) — the library
 *      itself has no lookup by id;
 *   3. the caller's OWN legacy clone (`voice_clones.gender`), when the caller
 *      is known;
 *   4. the premade catalog as the provider lists it today
 *      (`lib/premade-voice-catalog.ts`), for a premade voice the static
 *      catalog does not carry.
 * None of them: unknown, which the lock refuses (`judgeVoiceGender`).
 *
 * With no lock (`voice.allowedGenders` empty, the default) nothing here reads
 * anything: every verdict is an allow before any lookup. A lookup that FAILS
 * under a lock throws — a server error, never a silent allow and never a
 * refusal that blames the voice.
 */
import { supabase } from "./supabase.js"
import { getPremadeVoices } from "./premade-voice-catalog.js"
import { recordedLibraryVoiceGender } from "./library-voice-genders.js"
import {
  judgeVoiceGender,
  knownVoiceGender,
  premadeCatalogGender,
  voiceLockActive,
  VOICE_NOT_AVAILABLE_CODE,
  type VoiceGender,
  type VoiceVerdict,
} from "./voice-policy.js"

export interface VoiceLookup {
  /** Who is asking. A clone counts only as this user's own; absent → no clone is consulted. */
  readonly userId?: string | null
}

/** What a refused voice answers, wherever it is refused (a route's 400, a plugin's `PluginHttpError`). */
export const VOICE_NOT_AVAILABLE_MESSAGE = "The selected voice is not available on this deployment."

export function voiceNotAvailableBody(message: string = VOICE_NOT_AVAILABLE_MESSAGE): {
  error: { code: typeof VOICE_NOT_AVAILABLE_CODE; message: string }
} {
  return { error: { code: VOICE_NOT_AVAILABLE_CODE, message } }
}

/** A voice the lock refused. `reason` is for logs and tests; the client sees one code. */
export class VoiceNotAvailableError extends Error {
  readonly code = VOICE_NOT_AVAILABLE_CODE
  constructor(readonly reason: Extract<VoiceVerdict, { allowed: false }>["reason"]) {
    super(VOICE_NOT_AVAILABLE_MESSAGE)
    this.name = "VoiceNotAvailableError"
  }
}

const ALLOWED: VoiceVerdict = Object.freeze({ allowed: true })

async function ownCloneGender(voiceId: string, userId: string): Promise<VoiceGender | undefined> {
  const { data, error } = await supabase
    .from("voice_clones")
    .select("gender")
    .eq("elevenlabs_voice_id", voiceId)
    .eq("user_id", userId)
    .limit(1)
  if (error) throw new Error(`voice_clones lookup failed: ${error.message}`)
  return knownVoiceGender((data?.[0] as { gender?: string | null } | undefined)?.gender)
}

/** The gender the platform can vouch for, or undefined (unknown). Reads the sources above; throws on a failed read. */
export async function resolveVoiceGender(voice: string, lookup: VoiceLookup): Promise<VoiceGender | undefined> {
  const premade = premadeCatalogGender(voice)
  if (premade !== undefined) return premade
  const library = await recordedLibraryVoiceGender(voice)
  if (library !== undefined) return library
  const clone = lookup.userId ? await ownCloneGender(voice, lookup.userId) : undefined
  if (clone !== undefined) return clone
  const live = (await getPremadeVoices()).find((v) => v.voice_id === voice || v.name === voice)
  return live ? knownVoiceGender(live.gender) : undefined
}

/**
 * The lock's verdict for one voice. No lock: an allow, nothing read. An empty
 * voice has nothing to judge (the dispatch default voice is the policy's own,
 * `defaultAllowedVoiceId`).
 */
export async function judgeVoice(voice: string | null | undefined, lookup: VoiceLookup): Promise<VoiceVerdict> {
  if (!voiceLockActive() || !voice) return ALLOWED
  return judgeVoiceGender(await resolveVoiceGender(voice, lookup))
}

/** The lock's verdict for several voices (dialogue lines, a conversion's targets): the first refusal, else an allow. */
export async function judgeVoices(voices: ReadonlyArray<string | null | undefined>, lookup: VoiceLookup): Promise<VoiceVerdict> {
  const resolved = await resolveVoiceGenders(voices.filter((v): v is string => Boolean(v)), lookup)
  if (!resolved) return ALLOWED
  for (const g of resolved.values()) {
    const verdict = judgeVoiceGender(g)
    if (!verdict.allowed) return verdict
  }
  return ALLOWED
}

/**
 * Each voice's gender, looked up once per distinct voice — what a SYNCHRONOUS
 * builder is handed so it can judge with `judgeResolvedVoices` (the workflow
 * engine resolves the voices a speech node dispatches before `buildPayload`).
 * Undefined when no lock is set: there is nothing to resolve.
 */
export async function resolveVoiceGenders(
  voices: readonly string[],
  lookup: VoiceLookup,
): Promise<ReadonlyMap<string, VoiceGender | undefined> | undefined> {
  if (!voiceLockActive()) return undefined
  const distinct = [...new Set(voices.filter(Boolean))]
  const genders = await Promise.all(distinct.map((voice) => resolveVoiceGender(voice, lookup)))
  return new Map(distinct.map((voice, i) => [voice, genders[i]]))
}
