/**
 * The copilot answers in the language the person reads the app in.
 *
 * The interface locale rides with each turn (the composer sends the live
 * locale-store value, not the profile column — the menu switch is what the
 * person just did) and becomes ONE machine-authored line appended to the
 * per-turn context, never to the cached doctrine prefix: the prefix is shared
 * by every user and must stay byte-stable for the vendor's prompt cache.
 *
 * English produces no line at all — the doctrine is English and the model
 * already answers in it — so an English deployment's turns are byte-identical
 * to before this existed.
 */
import { LANGUAGES } from "@nodaro/shared"

export function replyLanguageLine(locale: string | null | undefined): string | null {
  if (!locale || locale === "en") return null
  const language = LANGUAGES.find((l) => l.id === locale)
  if (!language) return null
  return (
    `<reply-language>The user reads the interface in ${language.englishName} (${language.id}). ` +
    `Write every reply in ${language.englishName}. Keep node names, model and provider names, ` +
    `handle ids, file names and other technical identifiers exactly as they are.</reply-language>`
  )
}

/** The per-turn preamble with the reply-language instruction appended after it. */
export function withReplyLanguage(preamble: string, locale: string | null | undefined): string {
  const line = replyLanguageLine(locale)
  return line ? `${preamble}\n\n${line}` : preamble
}
