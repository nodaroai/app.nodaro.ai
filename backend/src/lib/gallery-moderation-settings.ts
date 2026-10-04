/**
 * The two admin-kept gallery moderation lists, as stored in `app_settings`:
 * the banned words (each with its translations and exceptions) and the
 * creators whose work never reaches the gallery.
 *
 * One parser per list, used by BOTH the reader (`getAppSettings`) and the
 * admin writer, so what is saved and what is enforced cannot disagree. The
 * parsers are tolerant: a malformed row degrades to the entries that are
 * well-formed (an empty list at worst), never to an error on every gallery
 * request.
 */
import type { GalleryWordEntry } from "./gallery-word-filter.js"

export const GALLERY_BLOCKED_WORDS_KEY = "gallery_blocked_words"
export const GALLERY_BANNED_USERS_KEY = "gallery_banned_users"

export const GALLERY_MODERATION_LIMITS = {
  words: 500,
  termLength: 60,
  exceptionLength: 120,
  translationsPerWord: 60,
  exceptionsPerWord: 60,
  bannedUsers: 2000,
} as const

export interface GalleryBannedUser {
  readonly userId: string
  /** ISO time the creator was blocked; null for an entry saved without one. */
  readonly addedAt: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value)
}

function cleanStrings(value: unknown, maxLength: number, maxCount: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== "string") continue
    const text = item.trim()
    if (text === "" || text.length > maxLength || out.includes(text)) continue
    out.push(text)
    if (out.length >= maxCount) break
  }
  return out
}

export function parseGalleryWordEntries(value: unknown): GalleryWordEntry[] {
  if (!Array.isArray(value)) return []
  const out: GalleryWordEntry[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
    const row = raw as Record<string, unknown>
    if (typeof row.word !== "string") continue
    const word = row.word.trim()
    if (word === "" || word.length > GALLERY_MODERATION_LIMITS.termLength) continue
    if (out.some((entry) => entry.word === word)) continue
    const exceptions = cleanStrings(row.exceptions, GALLERY_MODERATION_LIMITS.exceptionLength, GALLERY_MODERATION_LIMITS.exceptionsPerWord)
    // Suggested exceptions wait for an admin: an exception loosens the filter.
    const suggested = cleanStrings(row.suggestedExceptions, GALLERY_MODERATION_LIMITS.exceptionLength, GALLERY_MODERATION_LIMITS.exceptionsPerWord).filter(
      (phrase) => !exceptions.includes(phrase),
    )
    out.push({
      word,
      translations: cleanStrings(row.translations, GALLERY_MODERATION_LIMITS.termLength, GALLERY_MODERATION_LIMITS.translationsPerWord),
      exceptions,
      ...(suggested.length > 0 ? { suggestedExceptions: suggested } : {}),
    })
    if (out.length >= GALLERY_MODERATION_LIMITS.words) break
  }
  return out
}

export function parseGalleryBannedUsers(value: unknown): GalleryBannedUser[] {
  if (!Array.isArray(value)) return []
  const out: GalleryBannedUser[] = []
  for (const raw of value) {
    const row = typeof raw === "string" ? { userId: raw } : raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
    if (!row || !isUuid(row.userId)) continue
    const userId = row.userId.toLowerCase()
    if (out.some((entry) => entry.userId === userId)) continue
    out.push({ userId, addedAt: typeof row.addedAt === "string" ? row.addedAt : null })
    if (out.length >= GALLERY_MODERATION_LIMITS.bannedUsers) break
  }
  return out
}
