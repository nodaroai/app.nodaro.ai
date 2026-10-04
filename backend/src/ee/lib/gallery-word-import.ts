/**
 * After a list of banned words is imported, find each word's translations
 * and suggested allowed phrases in the background — a model call per word
 * is far too slow to hold the admin's request for.
 *
 * In-process and best-effort: a word whose search fails keeps its place on
 * the list without suggestions, and the admin can add them by hand. The page
 * shows which words are still being looked up (`wordsBeingFilled`).
 */
import { addGalleryWord } from "./gallery-moderation-store.js"
import { suggestForBannedWord } from "./gallery-word-suggestions.js"

/** Words looked up at the same time. */
const AT_ONCE = 3

const filling = new Set<string>()

/** The words whose suggestions are still being looked up. */
export function wordsBeingFilled(): string[] {
  return [...filling]
}

/** Look up suggestions for these words, a few at a time, and merge each into the list as it arrives. */
export async function fillSuggestionsInBackground(adminId: string, words: readonly string[], language: string | undefined): Promise<void> {
  const queue = words.filter((word) => !filling.has(word))
  for (const word of queue) filling.add(word)
  const worker = async (): Promise<void> => {
    for (let word = queue.shift(); word !== undefined; word = queue.shift()) {
      try {
        const suggestions = await suggestForBannedWord(word, { language })
        if (suggestions) await addGalleryWord(adminId, word, suggestions)
      } catch (error) {
        console.warn(`[gallery-moderation] no suggestions for an imported word:`, error instanceof Error ? error.message : error)
      } finally {
        filling.delete(word)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, queue.length) }, worker))
}
