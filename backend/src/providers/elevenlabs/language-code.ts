/**
 * ElevenLabs `language_code` funnel — ONE place that decides what (if
 * anything) goes on the wire as `language_code`.
 *
 * WHY THIS EXISTS. The TTS API documents `language_code` as ISO **639-1**
 * ("Language code (ISO 639-1) used to enforce a language for the model and
 * text normalization"), but our own callers pass a free string: the TTS route
 * (`routes/text-to-speech.ts:46` `z.string().optional()`), the MCP verbs
 * (`verbs-audio.ts:529, :876`), the pipeline speech service
 * (`ee/pipelines/services/pipeline-generate-speech.ts:90, :105`) and GVP's
 * dialogue track (`workers/handlers/video-ai.ts:1553-1560`). Some of those
 * values originate from ElevenLabs **Scribe**, which answers in ISO **639-3**
 * (`direct-stt.ts:128` reads `raw.language_code` verbatim). On 2026-08-31 a
 * Hebrew re-speak sent `language_code: "heb"` and the provider rejected it.
 *
 * WHAT IT DOES.
 *  1. Empty / whitespace / "auto"  -> omit the field (the documented way to
 *     ask for auto-detection).
 *  2. Lowercase, and drop any region/script subtag ("he-IL" -> "he").
 *  3. 3-letter code -> ISO 639-1 via {@link ISO_639_3_TO_1} when we know it;
 *     otherwise forwarded UNCHANGED (we do not guess, and `fil` is a real
 *     ElevenLabs code that is 3 letters by design).
 *  4. Models the API documents as not accepting the field -> omit.
 *
 * WHAT IT DOES NOT DO. It never runs on the speech-to-TEXT path
 * (`providers/kie/audio.ts:336`, `direct-stt.ts:66`): Scribe accepts and
 * returns 639-3, so normalizing there would be a regression.
 *
 * The map covers the languages ElevenLabs TTS supports (the union of the three
 * per-model lists in `frontend/src/lib/audio-tags.ts:128-183`), which is the
 * set Scribe can plausibly return for content we then re-speak. Both the
 * terminological (639-2/T) and bibliographic (639-2/B) 3-letter forms are
 * listed where they differ, because Scribe has been observed returning either.
 */

/** ISO 639-3 / 639-2 -> ISO 639-1, for every language ElevenLabs TTS supports. */
export const ISO_639_3_TO_1: Readonly<Record<string, string>> = {
  afr: "af",
  ara: "ar",
  ben: "bn",
  bul: "bg",
  cat: "ca",
  ces: "cs", cze: "cs",
  cmn: "zh", zho: "zh", chi: "zh",
  dan: "da",
  deu: "de", ger: "de",
  ell: "el", gre: "el",
  eng: "en",
  est: "et",
  fas: "fa", per: "fa",
  fin: "fi",
  fra: "fr", fre: "fr",
  heb: "he",
  hin: "hi",
  hrv: "hr",
  hun: "hu",
  ind: "id",
  isl: "is", ice: "is",
  ita: "it",
  jpn: "ja",
  kat: "ka", geo: "ka",
  kor: "ko",
  lav: "lv",
  lit: "lt",
  msa: "ms", may: "ms", zsm: "ms",
  nld: "nl", dut: "nl",
  nor: "no", nob: "no",
  pol: "pl",
  por: "pt",
  ron: "ro", rum: "ro",
  rus: "ru",
  slk: "sk", slo: "sk",
  spa: "es",
  srp: "sr",
  swa: "sw", swh: "sw",
  swe: "sv",
  tam: "ta",
  tha: "th",
  tur: "tr",
  ukr: "uk",
  urd: "ur",
  vie: "vi",
}

/**
 * Nodaro provider ids whose underlying ElevenLabs model does NOT accept
 * `language_code`. `elevenlabs-multilingual` resolves to `eleven_multilingual_v2`
 * (`direct-tts.ts:10`), which the API reference calls out explicitly: "This
 * parameter is not supported for multilingual_v2 models."
 *
 * `elevenlabs-v3` is deliberately NOT here: `he` / `th` / `bn` / `ur` / `fa`
 * are v3-only entries in our own per-model language picker
 * (`frontend/src/lib/audio-tags.ts:167-183`), which only makes sense because
 * v3 honours the field.
 */
export const MODELS_REJECTING_LANGUAGE_CODE: ReadonlySet<string> = new Set([
  "elevenlabs-multilingual",
])

/**
 * Resolve the `language_code` to put on an ElevenLabs TTS / dialogue request.
 * Returns `undefined` when the field must be omitted.
 *
 * @param provider Nodaro provider id ("elevenlabs-v3" | "elevenlabs-multilingual"
 *                 | "elevenlabs-turbo" | "elevenlabs" | undefined) — NOT a raw
 *                 ElevenLabs model_id.
 * @param raw      Whatever the caller passed (free string, possibly 639-3).
 */
export function languageCodeForModel(
  provider: string | undefined,
  raw: string | undefined,
): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed || trimmed === "auto") return undefined
  if (provider && MODELS_REJECTING_LANGUAGE_CODE.has(provider)) return undefined

  const base = trimmed.split(/[-_]/)[0]
  if (!base) return undefined
  if (base.length === 3) return ISO_639_3_TO_1[base] ?? base
  return base
}
