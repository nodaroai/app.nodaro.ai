/**
 * Gallery content filter — blocked words list.
 * Items whose prompt contains any of these words (case-insensitive partial match)
 * are automatically hidden from the public gallery.
 *
 * This list can later be moved to a database table managed from the admin panel.
 */
export const GALLERY_BLOCKED_WORDS: readonly string[] = [
  "sex",
  "nude",
  "naked",
  "porn",
  "vagina",
  "pussy",
  "penis",
  "dick",
  "fuck",
  "hentai",
  "xxx",
  "nsfw",
  "erotic",
  "orgasm",
  "masturbat",
]

/**
 * Check if a prompt string contains any blocked word (case-insensitive).
 * Returns true if the prompt is blocked.
 */
export function isPromptBlocked(prompt: string | null | undefined): boolean {
  if (!prompt) return false
  const lower = prompt.toLowerCase()
  return GALLERY_BLOCKED_WORDS.some((word) => lower.includes(word))
}
