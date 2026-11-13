/**
 * Where a dialogue's speakers go when the model and the voices were chosen
 * apart onto an ElevenLabs dialogue model (an app's Model card, a field
 * mapping): `dialogueVoicesForModel` leaves each voice only a named-voice model
 * speaks (Gemini) empty, which alone would voice every such speaker with the
 * deployment's one default voice. Decided 2026-11-13: each moved speaker gets
 * a DIFFERENT ElevenLabs voice instead — the deployment's default first, then
 * the premade voices in their catalog order, every one a voice the deployment's
 * voice lock allows — so two speakers stay two. A voice the script already uses
 * is never handed to a moved speaker.
 */
import { FALLBACK_VOICES } from "./premade-voices.js"
import { allowedVoiceGenders, defaultAllowedVoiceId, knownVoiceGender } from "./voice-policy.js"

/** The premade voices a moved speaker may take, in order: the deployment's default first. */
export function elevenLabsDialogueVoicePool(): string[] {
  const allowed = allowedVoiceGenders()
  const first = defaultAllowedVoiceId(FALLBACK_VOICES, "Rachel")
  const rest = FALLBACK_VOICES.filter((v) => {
    if (v.name === first || v.voice_id === first) return false
    if (allowed.length === 0) return true
    const g = knownVoiceGender(v.gender)
    return g !== undefined && allowed.includes(g)
  }).map((v) => v.voice_id)
  return [first, ...rest]
}

/**
 * Each line's voice with every emptied one (a speaker moved off a named-voice
 * model) given its own pool voice: the same original voice → the same pool
 * voice, two originals → two pool voices, none the script already speaks with.
 * `original` is each line's voice as the node holds it, `moved` the same lines
 * after `dialogueVoicesForModel`. A pool run dry leaves the rest empty (the
 * worker's default), never a voice already taken.
 */
export function distinctMovedVoices(original: readonly unknown[], moved: readonly string[], pool: readonly string[] = elevenLabsDialogueVoicePool()): string[] {
  const taken = new Set(moved.filter((v) => v !== ""))
  const given = new Map<string, string>()
  return moved.map((voice, i) => {
    if (voice !== "") return voice
    const from = typeof original[i] === "string" ? (original[i] as string) : ""
    if (from === "") return ""
    const kept = given.get(from)
    if (kept !== undefined) return kept
    const next = pool.find((p) => !taken.has(p)) ?? ""
    if (next !== "") taken.add(next)
    given.set(from, next)
    return next
  })
}
