/**
 * What keeps an output out of the PUBLIC gallery, asked the same way by every
 * surface that lists other people's public work: the web gallery
 * (`routes/gallery.ts` via `lib/gallery-listing.ts`, and the admin moderation
 * view), and the MCP `browse_gallery` / `list_jobs` public
 * scopes. `__tests__/gallery-moderation-totality.test.ts` fails the build for
 * a file that lists public jobs without coming through here.
 *
 * Three rules, all read at listing time — so lifting one (a word removed, a
 * creator unblocked) brings the work back at once, and nothing is rewritten:
 *   1. the built-in word list (`config/content-filter.ts`), on the shown prompt;
 *   2. the creators an admin blocked from the gallery;
 *   3. the words an admin barred (with their translations and exceptions), on
 *      every text the job was made from — never a negative prompt, which lists
 *      what to keep OUT of the result.
 *
 * Discovery only: a creator's own view of their work (`/v1/gallery?userId=`
 * by its owner) applies rule 1 alone, as before. The lists come from
 * `app_settings` through `getAppSettings`, so a change reaches the gallery
 * within its one-minute cache.
 */
import { getAppSettings, settingsReadFailed } from "./app-settings.js"
import { isPromptBlocked } from "../config/content-filter.js"
import { compileGalleryWords, findBannedWord, type CompiledGalleryWords, type GalleryWordEntry } from "./gallery-word-filter.js"
import { emailPatternToIlike, isUuid, type GalleryBannedEmailPattern, type GalleryBannedUser } from "./gallery-moderation-settings.js"
import { supabase } from "./supabase.js"

export interface GalleryModeration {
  readonly bannedUserIds: ReadonlySet<string>
  readonly words: CompiledGalleryWords
}

/** The built-in word list alone — a creator's own view of their work. */
export const OWNER_VIEW_MODERATION: GalleryModeration = { bannedUserIds: new Set(), words: compileGalleryWords([]) }

/** How many blocked creators are excluded in the query itself; the rest are dropped after it. */
export const MAX_QUERY_EXCLUDED_USERS = 150

let compiledFor: { words: readonly GalleryWordEntry[]; users: readonly GalleryBannedUser[]; patternUsers: readonly GalleryBannedUser[] } | null = null
let compiled: GalleryModeration = OWNER_VIEW_MODERATION

export function buildGalleryModeration(words: readonly GalleryWordEntry[], users: readonly GalleryBannedUser[]): GalleryModeration {
  return { bannedUserIds: new Set(users.map((user) => user.userId.toLowerCase())), words: compileGalleryWords(words) }
}

/** How long the accounts matching the email patterns are trusted before they are looked up again. */
const PATTERN_REFRESH_MS = 60_000
/** The most accounts one pattern may block. */
const MAX_ACCOUNTS_PER_PATTERN = 1000

const NO_ACCOUNTS: readonly GalleryBannedUser[] = []
let patternsFor: readonly GalleryBannedEmailPattern[] | null = null
let patternUsers: readonly GalleryBannedUser[] = []
let patternsReadAt = 0

/** The accounts whose email matches a blocked pattern; the last ones found when the lookup fails. */
async function accountsMatching(patterns: readonly GalleryBannedEmailPattern[]): Promise<readonly GalleryBannedUser[]> {
  if (patterns.length === 0) return NO_ACCOUNTS
  if (patternsFor === patterns && Date.now() - patternsReadAt < PATTERN_REFRESH_MS) return patternUsers
  try {
    const answers = await Promise.all(
      patterns.map((p) => supabase.from("profiles").select("id").ilike("email", emailPatternToIlike(p.pattern)).limit(MAX_ACCOUNTS_PER_PATTERN)),
    )
    const failed = answers.find((answer) => answer.error)
    if (failed?.error) throw new Error(failed.error.message)
    patternUsers = answers.flatMap(({ data }) => (data ?? []).map((row) => ({ userId: String(row.id).toLowerCase(), addedAt: null })))
    patternsFor = patterns
    patternsReadAt = Date.now()
  } catch (error) {
    console.error("[gallery-moderation] Could not look up the blocked email patterns:", error instanceof Error ? error.message : error)
  }
  return patternUsers
}

/**
 * The public gallery's rules as they stand (compiled once per settings
 * refresh). When the settings cannot be read, the last rules read stay in
 * force — never an unmoderated gallery because of a database hiccup. Blocked
 * email patterns are looked up again every minute, so an account made today
 * under a blocked pattern is out of the gallery within a minute.
 */
export async function loadGalleryModeration(): Promise<GalleryModeration> {
  const settings = await getAppSettings()
  if (settingsReadFailed(settings)) return compiled
  const words = settings.gallery_blocked_words ?? []
  const named = settings.gallery_banned_users ?? []
  const fromPatterns = await accountsMatching(settings.gallery_banned_email_patterns ?? [])
  if (!compiledFor || compiledFor.words !== words || compiledFor.users !== named || compiledFor.patternUsers !== fromPatterns) {
    compiled = buildGalleryModeration(words, [...named, ...fromPatterns])
    compiledFor = { words, users: named, patternUsers: fromPatterns }
  }
  return compiled
}

/**
 * The PostgREST list for `.filter("user_id", "not.in", …)`, or null when nobody is
 * blocked. Capped so the request line stays short; anyone past the cap is
 * still dropped by {@link galleryHides}.
 */
export function bannedGalleryUsersFilter(moderation: GalleryModeration): string | null {
  const ids = [...moderation.bannedUserIds].filter(isUuid).slice(0, MAX_QUERY_EXCLUDED_USERS)
  return ids.length === 0 ? null : `(${ids.join(",")})`
}

/** The prompt a gallery card shows: `prompt`, else `text`. */
export function galleryPromptOf(inputData: unknown): string | null {
  if (!inputData || typeof inputData !== "object") return null
  const data = inputData as Record<string, unknown>
  if (typeof data.prompt === "string") return data.prompt
  if (typeof data.text === "string") return data.text
  return null
}

const MAX_DEPTH = 4
const MAX_TEXT = 20_000
const NOT_PROSE = /^(?:https?:|data:|blob:)|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NEGATIVE_KEY = /negative/i
const OUTPUT_PROMPT_KEY = /prompt/i

interface Collected {
  readonly out: string[]
  readonly seen: Set<string>
  size: number
}

function collectText(value: unknown, depth: number, into: Collected): void {
  if (into.size >= MAX_TEXT || depth > MAX_DEPTH) return
  if (typeof value === "string") {
    const text = value.trim()
    if (text === "" || NOT_PROSE.test(text) || into.seen.has(text)) return
    const kept = text.slice(0, MAX_TEXT - into.size)
    into.out.push(kept)
    into.seen.add(text)
    into.size += kept.length
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, depth + 1, into)
    return
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (!NEGATIVE_KEY.test(key)) collectText(item, depth + 1, into)
    }
  }
}

/**
 * Every text the job was made from: the prompt a card shows — first and
 * whole, so no other field can push it out of reach — then the other strings
 * of its input (lyrics, titles, dialogue lines…) and any prompt its output
 * carries (a rewritten or enhanced prompt), up to a cap. Never a negative
 * prompt, a link or an id.
 */
export function galleryTextOf(inputData: unknown, outputData?: unknown): string {
  const prompt = galleryPromptOf(inputData)?.trim() ?? ""
  const into: Collected = { out: prompt ? [prompt] : [], seen: new Set(prompt ? [prompt] : []), size: 0 }
  collectText(inputData, 0, into)
  if (outputData && typeof outputData === "object" && !Array.isArray(outputData)) {
    for (const [key, item] of Object.entries(outputData as Record<string, unknown>)) {
      if (OUTPUT_PROMPT_KEY.test(key) && !NEGATIVE_KEY.test(key)) collectText(item, 1, into)
    }
  }
  return into.out.join("\n")
}

export interface GalleryCandidate {
  readonly userId: string | null | undefined
  readonly inputData: unknown
  readonly outputData?: unknown
}

/** True when this output must stay out of the public gallery. */
export function galleryHides(moderation: GalleryModeration, item: GalleryCandidate): boolean {
  if (isPromptBlocked(galleryPromptOf(item.inputData))) return true
  if (item.userId && moderation.bannedUserIds.has(item.userId.toLowerCase())) return true
  if (moderation.words.entries.length === 0) return false
  return findBannedWord(galleryTextOf(item.inputData, item.outputData), moderation.words) !== null
}
