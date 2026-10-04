/**
 * Writes the two gallery moderation lists (`app_settings`), for the admin
 * routes. Every change is a read-modify-write that only lands if nobody else
 * wrote the list in between (compare-and-set on `updated_at`, retried), so
 * two admins editing at once never erase each other's work.
 *
 * Shapes and limits come from `lib/gallery-moderation-settings.ts` — the same
 * parsers the gallery reads with — and the enforcing side picks a change up
 * within its one-minute settings cache (`invalidateSettingsCache` makes this
 * process see it at once).
 */
import { supabase } from "../../lib/supabase.js"
import { invalidateSettingsCache } from "../../lib/app-settings.js"
import { compileGalleryWords, findBannedWord, normalizeForFilter, type GalleryWordEntry } from "../../lib/gallery-word-filter.js"
import {
  GALLERY_BANNED_EMAIL_PATTERNS_KEY,
  GALLERY_BANNED_USERS_KEY,
  GALLERY_BLOCKED_WORDS_KEY,
  GALLERY_MODERATION_LIMITS,
  cleanEmailPattern,
  parseGalleryBannedUsers,
  parseGalleryEmailPatterns,
  parseGalleryWordEntries,
  type GalleryBannedEmailPattern,
  type GalleryBannedUser,
} from "../../lib/gallery-moderation-settings.js"

/** A change the lists refuse, with a code the admin page can explain. */
export class GalleryModerationError extends Error {
  constructor(
    readonly code:
      | "empty_word"
      | "word_too_long"
      | "too_many_words"
      | "too_many_entries"
      | "unknown_word"
      | "exception_without_word"
      | "too_many_users"
      | "bad_pattern"
      | "busy",
    message: string,
  ) {
    super(message)
    this.name = "GalleryModerationError"
  }
}

const MAX_ATTEMPTS = 5

interface StoredRow {
  readonly raw: unknown
  readonly updatedAt: string | null
}

async function readRow(key: string): Promise<StoredRow> {
  const { data, error } = await supabase.from("app_settings").select("value, updated_at").eq("key", key).maybeSingle()
  if (error) throw new Error(`Could not read ${key}: ${error.message}`)
  return { raw: data?.value ?? null, updatedAt: (data?.updated_at as string | undefined) ?? null }
}

/** Write `value` only if the row is still the one read. False: someone else wrote first. */
async function writeRow(key: string, value: unknown, readAt: string | null, adminId: string): Promise<boolean> {
  const row = { value, updated_at: new Date().toISOString(), updated_by: adminId }
  if (readAt === null) {
    const { error } = await supabase.from("app_settings").insert({ key, ...row })
    if (!error) return true
    if (error.code === "23505") return false
    throw new Error(`Could not save ${key}: ${error.message}`)
  }
  const { data, error } = await supabase.from("app_settings").update(row).eq("key", key).eq("updated_at", readAt).select("key")
  if (error) throw new Error(`Could not save ${key}: ${error.message}`)
  return (data?.length ?? 0) > 0
}

async function mutate<T>(key: string, parse: (raw: unknown) => T, change: (current: T) => T, adminId: string): Promise<T> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { raw, updatedAt } = await readRow(key)
    const next = change(parse(raw))
    if (await writeRow(key, next, updatedAt, adminId)) {
      invalidateSettingsCache()
      return next
    }
  }
  throw new GalleryModerationError("busy", "The list changed too many times at once. Try again.")
}

export async function readGalleryWords(): Promise<GalleryWordEntry[]> {
  return parseGalleryWordEntries((await readRow(GALLERY_BLOCKED_WORDS_KEY)).raw)
}

export async function readGalleryEmailPatterns(): Promise<GalleryBannedEmailPattern[]> {
  return parseGalleryEmailPatterns((await readRow(GALLERY_BANNED_EMAIL_PATTERNS_KEY)).raw)
}

/** Block every account whose email matches the pattern — now and later. */
export async function addGalleryEmailPattern(adminId: string, raw: string): Promise<GalleryBannedEmailPattern[]> {
  const pattern = cleanEmailPattern(raw)
  if (!pattern) {
    throw new GalleryModerationError("bad_pattern", "Use letters, digits and . _ - + @, with * for anything, and at least 4 letters or digits before the @.")
  }
  return mutate(
    GALLERY_BANNED_EMAIL_PATTERNS_KEY,
    parseGalleryEmailPatterns,
    (patterns) => {
      if (patterns.some((entry) => entry.pattern === pattern)) return patterns
      if (patterns.length >= GALLERY_MODERATION_LIMITS.emailPatterns) {
        throw new GalleryModerationError("too_many_users", `Up to ${GALLERY_MODERATION_LIMITS.emailPatterns} patterns can be blocked.`)
      }
      return [{ pattern, addedAt: new Date().toISOString() }, ...patterns]
    },
    adminId,
  )
}

export async function removeGalleryEmailPattern(adminId: string, raw: string): Promise<GalleryBannedEmailPattern[]> {
  const pattern = raw.trim().toLowerCase()
  return mutate(GALLERY_BANNED_EMAIL_PATTERNS_KEY, parseGalleryEmailPatterns, (patterns) => patterns.filter((entry) => entry.pattern !== pattern), adminId)
}

export async function readGalleryBannedUsers(): Promise<GalleryBannedUser[]> {
  return parseGalleryBannedUsers((await readRow(GALLERY_BANNED_USERS_KEY)).raw)
}

// ─── Words ───────────────────────────────────────────────────────────────

const same = (a: string, b: string) => normalizeForFilter(a) === normalizeForFilter(b)

/** A word the list can hold: not blank once compared, not too long. Throws the reason. */
export function checkTerm(term: string): string {
  const text = term.trim()
  if (text === "" || normalizeForFilter(text) === "") throw new GalleryModerationError("empty_word", "Type a word.")
  if (text.length > GALLERY_MODERATION_LIMITS.termLength) {
    throw new GalleryModerationError("word_too_long", `A word can be up to ${GALLERY_MODERATION_LIMITS.termLength} characters.`)
  }
  return text
}

/** `list` plus `additions` that are new (by comparable form), trimmed, capped at `max`. */
function merged(list: readonly string[], additions: readonly string[], maxLength: number, max: number): string[] {
  const out = [...list]
  for (const raw of additions) {
    const text = raw.trim()
    if (text === "" || text.length > maxLength || out.some((have) => same(have, text))) continue
    if (out.length >= max) throw new GalleryModerationError("too_many_entries", `A word can have up to ${max} entries in each list.`)
    out.push(text)
  }
  return out
}

/**
 * Add a banned word, with the suggestions found for it. Adding a word already
 * on the list keeps it and merges the new suggestions in.
 *
 * Suggested translations apply at once — they only make the filter stricter,
 * and the admin deletes the wrong ones. Suggested exceptions make it looser,
 * so they wait in `suggestedExceptions` until an admin approves each one.
 */
export async function addGalleryWord(
  adminId: string,
  word: string,
  suggestions: { translations: readonly string[]; exceptions: readonly string[] },
): Promise<GalleryWordEntry[]> {
  const text = checkTerm(word)
  return mutate(
    GALLERY_BLOCKED_WORDS_KEY,
    parseGalleryWordEntries,
    (words) => {
      const at = words.findIndex((entry) => same(entry.word, text))
      if (at < 0 && words.length >= GALLERY_MODERATION_LIMITS.words) {
        throw new GalleryModerationError("too_many_words", `The list can hold up to ${GALLERY_MODERATION_LIMITS.words} words.`)
      }
      const base: GalleryWordEntry = at >= 0 ? words[at]! : { word: text, translations: [], exceptions: [] }
      const translations = mergedLenient(base.translations, suggestions.translations, GALLERY_MODERATION_LIMITS.termLength, GALLERY_MODERATION_LIMITS.translationsPerWord)
      const suggested = mergedLenient(
        base.suggestedExceptions ?? [],
        suggestions.exceptions.filter((phrase) => !base.exceptions.some((have) => same(have, phrase)) && freesSomething({ ...base, translations }, phrase)),
        GALLERY_MODERATION_LIMITS.exceptionLength,
        GALLERY_MODERATION_LIMITS.exceptionsPerWord,
      )
      const next: GalleryWordEntry = {
        word: base.word,
        translations,
        exceptions: base.exceptions,
        ...(suggested.length > 0 ? { suggestedExceptions: suggested } : {}),
      }
      return at >= 0 ? words.map((entry, i) => (i === at ? next : entry)) : [next, ...words]
    },
    adminId,
  )
}

/** Like {@link merged}, but stops quietly at the cap — for suggestions, never for the admin's own typing. */
function mergedLenient(list: readonly string[], additions: readonly string[], maxLength: number, max: number): string[] {
  const out = [...list]
  for (const raw of additions) {
    if (out.length >= max) break
    const text = raw.trim()
    if (text === "" || text.length > maxLength || out.some((have) => same(have, text))) continue
    out.push(text)
  }
  return out
}

/** Would this phrase free anything — does the entry catch it at all? */
function freesSomething(entry: GalleryWordEntry, phrase: string): boolean {
  return findBannedWord(phrase, compileGalleryWords([{ ...entry, exceptions: [] }])) !== null
}

export interface GalleryWordEdit {
  readonly addTranslations?: readonly string[]
  readonly removeTranslations?: readonly string[]
  readonly addExceptions?: readonly string[]
  readonly removeExceptions?: readonly string[]
  /** Suggested exceptions the admin accepts: they move to `exceptions` and apply. */
  readonly approveExceptions?: readonly string[]
  /** Suggested exceptions the admin turns down. */
  readonly dismissExceptions?: readonly string[]
}

/** Add or remove translations and exceptions of a word on the list; approve or dismiss suggested exceptions. */
export async function editGalleryWord(adminId: string, word: string, edit: GalleryWordEdit): Promise<GalleryWordEntry[]> {
  return mutate(
    GALLERY_BLOCKED_WORDS_KEY,
    parseGalleryWordEntries,
    (words) => {
      const at = words.findIndex((entry) => same(entry.word, word))
      if (at < 0) throw new GalleryModerationError("unknown_word", "That word is not on the list any more.")
      const entry = words[at]!
      const dropped = (list: readonly string[], remove: readonly string[] = []) => list.filter((have) => !remove.some((gone) => same(gone, have)))
      for (const term of edit.addTranslations ?? []) checkTerm(term)
      const translations = merged(
        dropped(entry.translations, edit.removeTranslations),
        edit.addTranslations ?? [],
        GALLERY_MODERATION_LIMITS.termLength,
        GALLERY_MODERATION_LIMITS.translationsPerWord,
      )
      const withTranslations: GalleryWordEntry = { ...entry, translations }
      const pending = entry.suggestedExceptions ?? []
      const approved = pending.filter((phrase) => (edit.approveExceptions ?? []).some((yes) => same(yes, phrase)))
      for (const phrase of [...(edit.addExceptions ?? []), ...approved]) {
        if (phrase.trim().length > GALLERY_MODERATION_LIMITS.exceptionLength) {
          throw new GalleryModerationError("word_too_long", `A phrase can be up to ${GALLERY_MODERATION_LIMITS.exceptionLength} characters.`)
        }
        if (phrase.trim() !== "" && !freesSomething(withTranslations, phrase)) {
          throw new GalleryModerationError(
            "exception_without_word",
            `"${phrase.trim()}" does not contain "${entry.word}" or one of its translations, so it would change nothing.`,
          )
        }
      }
      const exceptions = merged(
        dropped(entry.exceptions, edit.removeExceptions),
        [...(edit.addExceptions ?? []), ...approved],
        GALLERY_MODERATION_LIMITS.exceptionLength,
        GALLERY_MODERATION_LIMITS.exceptionsPerWord,
      )
      const stillPending = dropped(dropped(pending, edit.dismissExceptions), approved).filter((phrase) => !exceptions.some((have) => same(have, phrase)))
      const { suggestedExceptions: _previous, ...rest } = withTranslations
      const next: GalleryWordEntry = { ...rest, exceptions, ...(stillPending.length > 0 ? { suggestedExceptions: stillPending } : {}) }
      return words.map((have, i) => (i === at ? next : have))
    },
    adminId,
  )
}

/**
 * Add many banned words at once (an imported list), without suggestions —
 * those are found afterwards, one word at a time. Words already on the list
 * are left as they are. Refuses the whole list when it would not fit.
 */
export async function addGalleryWords(adminId: string, list: readonly string[]): Promise<GalleryWordEntry[]> {
  const texts = list.map(checkTerm)
  return mutate(
    GALLERY_BLOCKED_WORDS_KEY,
    parseGalleryWordEntries,
    (words) => {
      const fresh = texts.filter((text, i) => !words.some((entry) => same(entry.word, text)) && texts.findIndex((other) => same(other, text)) === i)
      if (words.length + fresh.length > GALLERY_MODERATION_LIMITS.words) {
        throw new GalleryModerationError("too_many_words", `The list can hold up to ${GALLERY_MODERATION_LIMITS.words} words.`)
      }
      return [...fresh.map((word) => ({ word, translations: [], exceptions: [] })), ...words]
    },
    adminId,
  )
}

export async function removeGalleryWord(adminId: string, word: string): Promise<GalleryWordEntry[]> {
  return mutate(GALLERY_BLOCKED_WORDS_KEY, parseGalleryWordEntries, (words) => words.filter((entry) => !same(entry.word, word)), adminId)
}

// ─── Creators ────────────────────────────────────────────────────────────

export async function blockGalleryCreators(adminId: string, userIds: readonly string[]): Promise<GalleryBannedUser[]> {
  const addedAt = new Date().toISOString()
  return mutate(
    GALLERY_BANNED_USERS_KEY,
    parseGalleryBannedUsers,
    (users) => {
      const fresh = [...new Set(userIds.map((id) => id.toLowerCase()))].filter((id) => !users.some((user) => user.userId === id))
      if (users.length + fresh.length > GALLERY_MODERATION_LIMITS.bannedUsers) {
        throw new GalleryModerationError("too_many_users", `Up to ${GALLERY_MODERATION_LIMITS.bannedUsers} creators can be blocked.`)
      }
      return [...fresh.map((userId) => ({ userId, addedAt })), ...users]
    },
    adminId,
  )
}

export async function unblockGalleryCreator(adminId: string, userId: string): Promise<GalleryBannedUser[]> {
  const id = userId.toLowerCase()
  return mutate(GALLERY_BANNED_USERS_KEY, parseGalleryBannedUsers, (users) => users.filter((user) => user.userId !== id), adminId)
}
