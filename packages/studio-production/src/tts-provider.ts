import { TTS_PROVIDERS, type TtsProvider, type VoiceType } from "@nodaro/shared"

/**
 * Single-source TTS provider resolution. Every `text-to-speech` call site
 * AND its cost preview must resolve the provider through this one function
 * so the quoted cost always matches what actually gets sent (two independent
 * derivations of the same value is exactly the drift CLAUDE.md forbids).
 *
 * `elevenlabs-v3` is ElevenLabs' best TTS model and the platform's canonical
 * default — fully multilingual (Hebrew included). A voice's STORED
 * recommendation wins over the default: Voice Library entries are verified
 * on a specific model (`SharedVoice.recommendedProvider`, v2-era turbo/
 * multilingual), and rendering them elsewhere can drift from the browser
 * preview the user picked. Premade/custom voices carry no such
 * recommendation, so they always resolve to the default.
 */
export function resolveTtsProvider(voice?: { readonly ttsProvider?: TtsProvider }): TtsProvider {
  return voice?.ttsProvider ?? "elevenlabs-v3"
}

/**
 * Narrow an unknown value to a known {@link TtsProvider} id — the ONE guard
 * every reader of an untrusted `ttsProvider` field uses (plan-import-v2 D4
 * fix round 1): the import pipeline's repair step (`repairVoice`) and the
 * canvas-persisted plan reader (`scene-plan.ts`'s `readVoice`) both narrow
 * through this rather than hand-typing (or skipping) the check — an id valid
 * nowhere on the platform must never reach a `text-to-speech` call, and must
 * never silently vanish on a LATER reload after surviving an earlier one.
 */
export function isTtsProvider(value: unknown): value is TtsProvider {
  return typeof value === "string" && (TTS_PROVIDERS as ReadonlyArray<string>).includes(value)
}

/**
 * {@link VoiceType}'s own three values, as a RUNTIME list (plan-import-v2 D4)
 * — `@nodaro/shared` exports only the type, so this is the one place the
 * voice DOMAIN spells it out, beside {@link isTtsProvider} (fix round 1, R38
 * item 2): `production-format`'s schema/repair layer imports it from here,
 * never the reverse — the format is an import/export concern layered ON the
 * voice domain, not the domain's owner. Pinned both directions in
 * `coverage-guard.test.ts`.
 */
export const VOICE_TYPES = ["premade", "library", "custom"] as const satisfies ReadonlyArray<VoiceType>

/**
 * Narrow an unknown value to a known {@link VoiceType} — the twin of
 * {@link isTtsProvider}, and for the same reason: the import pipeline's repair
 * step (`repairVoice`) and the canvas-persisted plan reader (`scene-plan.ts`'s
 * `readVoice`) each hand-rolled the same `VOICE_TYPES.includes` cast, so the
 * check lives here once, beside the list it reads.
 */
export function isVoiceType(value: unknown): value is VoiceType {
  return typeof value === "string" && (VOICE_TYPES as ReadonlyArray<string>).includes(value)
}
