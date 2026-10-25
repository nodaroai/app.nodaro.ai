import type { LocaleId } from "@nodaro/shared/i18n"

/**
 * The interface languages Nodaro offers — the same set in EVERY Nodaro
 * product (this app, Studio, the creative tools, the shared site header).
 * The viewer sees one product with many worlds and one language choice
 * shared between them, so a language exists in all of them or in none: a new
 * one is added to every product together, never to one first.
 *
 * The app does not offer from this list (`offered-locales.ts` derives its menu
 * from the dictionaries); `__tests__/platform-languages.test.ts` fails when the
 * two disagree, which is when this rule is being broken.
 */
export const PLATFORM_LANGUAGES: readonly LocaleId[] = Object.freeze(["en", "he", "ja", "ko", "pt-BR"] as const)
