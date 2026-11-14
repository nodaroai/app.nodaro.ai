import { DUBBING_SOURCE_LANGUAGE } from "@nodaro/shared/media"
import { PROJECT_DUBBING_LANGUAGES, dubsAsProject } from "./dubbing-model.js"

/**
 * How a dub's language codes are compared.
 *
 * Kept apart from the dub's family, which reads the dubbing service, so a
 * caller that only matches a code loads none of that.
 */

const PROJECT_LANGUAGE = PROJECT_DUBBING_LANGUAGES[0] ?? ""

/** One spelling per language: codes differ by case, and the project engine's language has two codes. */
export function canonicalLanguage(code: string): string {
  const trimmed = code.trim()
  return dubsAsProject(trimmed) ? PROJECT_LANGUAGE : trimmed.toLowerCase()
}

/** True when two codes name one language. */
export const sameLanguage = (a: string, b: string): boolean => canonicalLanguage(a) === canonicalLanguage(b)

/** True when what a caller asks to read is the dub's original speech, not one of its languages. */
export const asksForSource = (language: string): boolean => language.trim().toLowerCase() === DUBBING_SOURCE_LANGUAGE
