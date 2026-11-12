import { TRANSCRIBE_TARGET_LANGUAGES, transcribeLaneSupportsTranslation, type TranscribeTargetLanguage } from "@nodaro/shared/models"
import type { MessageKey } from "@/lib/i18n"

/**
 * The Transcribe node's "Translate to" choice (Nemotron 3.5 Transcribe only):
 * the label of each language KIE translates into, and the fail-safe that
 * clears the choice when the engine cannot translate (Provider Enum Sync,
 * pitfall 5 — a stale value would be refused at run time). Pure, so it is
 * testable without mounting the audio-configs panel.
 */
export const TRANSCRIBE_TARGET_LANGUAGE_LABEL_KEYS: Readonly<Record<TranscribeTargetLanguage, MessageKey>> = {
  en: "langname.en",
  zh: "langname.zh",
  ja: "langname.ja",
  ko: "langname.ko",
  fr: "langname.fr",
  de: "langname.de",
  es: "langname.es",
  pt: "langname.pt",
  it: "langname.it",
  ru: "langname.ru",
  nl: "langname.nl",
  pl: "langname.pl",
  cs: "langname.cs",
  sk: "langname.sk",
  hi: "langname.hi",
  bg: "langname.bg",
  hr: "langname.hr",
  da: "langname.da",
  et: "langname.et",
  fi: "langname.fi",
  hu: "langname.hu",
  lv: "langname.lv",
  lt: "langname.lt",
  ro: "langname.ro",
  sl: "langname.sl",
  sv: "langname.sv",
  th: "langname.th",
  uk: "langname.uk",
  ar: "langname.ar",
  el: "langname.el",
  he: "langname.he",
  mt: "langname.mt",
}

/** The languages offered, in KIE's order (English first). */
export const TRANSCRIBE_TARGET_LANGUAGE_OPTIONS: readonly TranscribeTargetLanguage[] = TRANSCRIBE_TARGET_LANGUAGES

/**
 * The patch that keeps a node's translation valid for its engine: clears a
 * `targetLanguage` the engine cannot run (it does not translate), else nothing.
 */
export function transcribeTranslationSnap(provider: string | undefined, targetLanguage: unknown): { targetLanguage: undefined } | null {
  if (targetLanguage === undefined || targetLanguage === null || targetLanguage === "") return null
  return transcribeLaneSupportsTranslation(provider) ? null : { targetLanguage: undefined }
}
