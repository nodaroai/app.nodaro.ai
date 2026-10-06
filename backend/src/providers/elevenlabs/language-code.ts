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
 * The map covers the languages ElevenLabs TTS supports (the union of the
 * speech models' `tts.languages` in `MODEL_CATALOG`), which is the
 * set Scribe can plausibly return for content we then re-speak. Both the
 * terminological (639-2/T) and bibliographic (639-2/B) 3-letter forms are
 * listed where they differ, because Scribe has been observed returning either.
 */
import { getTtsCapabilities } from "@nodaro/shared"

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
 * Normalise a caller's language code for an ElevenLabs speech request: empty /
 * "auto" → undefined (auto-detect); lowercase; drop a region/script subtag;
 * a known 3-letter code → ISO 639-1. Says nothing about whether the MODEL takes
 * the field — that is the model's sheet (`languageCode`), asked by the caller.
 */
export function normalizeElevenLabsLanguageCode(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed || trimmed === "auto") return undefined
  const base = trimmed.split(/[-_]/)[0]
  if (!base) return undefined
  if (base.length === 3) return ISO_639_3_TO_1[base] ?? base
  return base
}

/**
 * Resolve the `language_code` for a TEXT-TO-SPEECH request. Returns `undefined`
 * when the field must be omitted — whether the model takes it is its capability
 * sheet's `languageCode` (today only `elevenlabs-multilingual` says no: the API
 * reference calls out "This parameter is not supported for multilingual_v2
 * models"). The dialogue funnel asks its own sheet (`getDialogueCapabilities`).
 *
 * @param provider Nodaro text-to-speech provider id — NOT a raw ElevenLabs model_id.
 * @param raw      Whatever the caller passed (free string, possibly 639-3).
 */
export function languageCodeForModel(
  provider: string | undefined,
  raw: string | undefined,
): string | undefined {
  // A missing or unknown provider runs as turbo, which takes the field — the
  // same answer the sheet's fallback gives, so no special case is needed.
  if (!getTtsCapabilities(provider).languageCode) return undefined
  return normalizeElevenLabsLanguageCode(raw)
}
