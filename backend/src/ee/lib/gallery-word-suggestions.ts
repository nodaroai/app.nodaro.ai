/**
 * Suggestions for a word an admin bars from the public gallery: the same word
 * in other languages, and the innocent phrases that contain it (a word that
 * is vulgar in one sense and "cup" in another needs "a cup of coffee" freed).
 *
 * Suggestions only — the admin sees every one and deletes the wrong ones;
 * that review is the real safeguard, the instructions below just make it
 * short. Never throws: a refusal, a timeout or a malformed answer means "no
 * suggestions", and the word is still added; the admin types the rest.
 */
import { z } from "zod"
import { llmCompleteStructured } from "../../lib/llm-client.js"
import { compileGalleryWords, findBannedWord, normalizeForFilter } from "../../lib/gallery-word-filter.js"
import { GALLERY_MODERATION_LIMITS } from "../../lib/gallery-moderation-settings.js"

export interface GalleryWordSuggestions {
  readonly translations: string[]
  readonly exceptions: string[]
}

const SYSTEM = `You help the moderators of a public gallery of AI-generated images. They keep a list of banned words: any image whose prompt contains one is kept out of the public gallery. You receive one banned word or short phrase, in any language — and, when the moderator said it, the language it is written in ("language"): read the word in that language. Return JSON with two lists.

"translations": how people write THE SAME MEANING in other languages — the vulgar, sexual or offensive sense the moderator banned, never an innocent sense of the word. Cover the languages people prompt in: English, Hebrew, Arabic, Russian, Spanish, Portuguese, French, German, Italian, Turkish, Polish, Dutch, Hindi, Indonesian, Japanese, Korean, Chinese, Thai, Vietnamese. Include the common slang and spellings, and the transliterations into Latin letters that people actually type. Leave out:
- any form that is also an everyday innocent word in some major language (French "con" is also Spanish "with"; a word that also means "cup" or "glass");
- forms longer than three words;
- the word itself.

"exceptions": short, common phrases that CONTAIN the banned word (or one of your translations) and are innocent, so they should stay allowed — for a word that also means "cup": "a cup of coffee", "cup of tea", "a glass of water"; in the word's own language first. Include them only when the word really has an innocent everyday sense. For a Hebrew word, also list innocent words that are the banned word after a one-letter prefix (ו, ה, ב, ל, מ, ש, כ) but mean something else. Never list a phrase that could still carry the banned sense.

Return only JSON matching the schema. Empty lists are fine.`

// Google constrained-decode congruence (see content-policy-rewrite.ts): no
// array .max() and no .int() in the schema — the caps are applied after.
const SuggestionSchema = z.object({
  translations: z.array(z.string()),
  exceptions: z.array(z.string()),
})

/**
 * Who answers, and for how long. The admin waits on this, and a request held
 * past the edge's ~100 s would show an error while the word is still saved,
 * so the whole search stays near a minute: the second model is asked only
 * while there is time left for it.
 */
const MODELS = [
  { modelId: "claude-sonnet-5", timeoutMs: 30_000, maxRetries: 1 },
  { modelId: "gemini-3.6-flash", timeoutMs: 20_000, maxRetries: 0 },
] as const
const SECOND_MODEL_DEADLINE_MS = 40_000
const MAX_SUGGESTED_TRANSLATIONS = 40
const MAX_SUGGESTED_EXCEPTIONS = 30

function distinct(list: readonly string[], maxLength: number, maxCount: number, skip: ReadonlySet<string>): string[] {
  const seen = new Set(skip)
  const out: string[] = []
  for (const raw of list) {
    const text = raw.trim()
    const key = normalizeForFilter(text)
    if (key === "" || text.length > maxLength || seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length >= maxCount) break
  }
  return out
}

/**
 * Keep what is usable: trimmed, within the stored limits, no repeats, never
 * the word itself — and an exception only when the word or a kept translation
 * is in it (one that contains neither would free nothing).
 */
export function cleanSuggestions(word: string, raw: { translations: readonly string[]; exceptions: readonly string[] }): GalleryWordSuggestions {
  const translations = distinct(
    raw.translations,
    GALLERY_MODERATION_LIMITS.termLength,
    Math.min(MAX_SUGGESTED_TRANSLATIONS, GALLERY_MODERATION_LIMITS.translationsPerWord),
    new Set([normalizeForFilter(word)]),
  )
  const entry = compileGalleryWords([{ word, translations, exceptions: [] }])
  const exceptions = distinct(
    raw.exceptions,
    GALLERY_MODERATION_LIMITS.exceptionLength,
    Math.min(MAX_SUGGESTED_EXCEPTIONS, GALLERY_MODERATION_LIMITS.exceptionsPerWord),
    new Set(),
  ).filter((phrase) => findBannedWord(phrase, entry) !== null)
  return { translations, exceptions }
}

/** Suggestions for one banned word, or null when no model could give any. */
export async function suggestForBannedWord(
  word: string,
  { language, now = Date.now }: { readonly language?: string; readonly now?: () => number } = {},
): Promise<GalleryWordSuggestions | null> {
  const started = now()
  for (const [i, { modelId, timeoutMs, maxRetries }] of MODELS.entries()) {
    if (i > 0 && now() - started > SECOND_MODEL_DEADLINE_MS) break
    try {
      const { output } = await llmCompleteStructured(
        {
          modelId,
          system: SYSTEM,
          messages: [{ role: "user", content: JSON.stringify(language ? { bannedWord: word, language } : { bannedWord: word }) }],
          temperature: 0,
          maxTokens: 4096,
          timeoutMs,
        },
        SuggestionSchema,
        { schemaName: "gallery_word_suggestions", maxRetries },
      )
      return cleanSuggestions(word, output)
    } catch (error) {
      console.warn(`[gallery-moderation] ${modelId} gave no suggestions:`, error instanceof Error ? error.message : error)
    }
  }
  return null
}
