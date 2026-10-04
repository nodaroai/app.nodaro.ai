import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { formatZodError } from "../../lib/zod-error.js"
import { MAX_GALLERY_REMOVAL } from "../../lib/gallery-removal.js"
import { GALLERY_MODERATION_LIMITS, emailPatternToIlike, type GalleryBannedEmailPattern, type GalleryBannedUser } from "../../lib/gallery-moderation-settings.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { loadGalleryModeration } from "../../lib/gallery-moderation.js"
import { readGalleryPage } from "../../lib/gallery-listing.js"
import { suggestForBannedWord } from "../lib/gallery-word-suggestions.js"
import { fillSuggestionsInBackground, wordsBeingFilled } from "../lib/gallery-word-import.js"
import {
  GalleryModerationError,
  addGalleryWord,
  addGalleryWords,
  addGalleryEmailPattern,
  readGalleryEmailPatterns,
  removeGalleryEmailPattern,
  checkTerm,
  blockGalleryCreators,
  editGalleryWord,
  readGalleryBannedUsers,
  readGalleryWords,
  removeGalleryWord,
  unblockGalleryCreator,
} from "../lib/gallery-moderation-store.js"

/**
 * Admin moderation of the public gallery: the banned words (with their
 * translations and exceptions) and the creators whose work never reaches it.
 * Enforced by `lib/gallery-moderation.ts` on every gallery listing.
 *
 * Moderation, not money — so `requireAdmin`, not the operator gate the
 * generic settings PUT uses.
 */

const term = z.string().trim().min(1).max(GALLERY_MODERATION_LIMITS.termLength)
const phrase = z.string().trim().min(1).max(GALLERY_MODERATION_LIMITS.exceptionLength)
const list = <T extends z.ZodTypeAny>(item: T) => z.array(item).max(GALLERY_MODERATION_LIMITS.translationsPerWord).optional()

/** The language the admin says the words are in, passed to the model as a hint. */
const language = z.string().trim().min(1).max(40).optional()
const addWordBody = z.object({ word: term, language })
/** The most words one import may carry. */
const MAX_IMPORT = 200
const importBody = z.object({ words: z.array(z.string()).min(1).max(MAX_IMPORT), language })
const editWordBody = z.object({
  word: term,
  addTranslations: list(term),
  removeTranslations: list(z.string().max(GALLERY_MODERATION_LIMITS.termLength)),
  addExceptions: list(phrase),
  removeExceptions: list(z.string().max(GALLERY_MODERATION_LIMITS.exceptionLength)),
  approveExceptions: list(z.string().max(GALLERY_MODERATION_LIMITS.exceptionLength)),
  dismissExceptions: list(z.string().max(GALLERY_MODERATION_LIMITS.exceptionLength)),
})
const removeWordBody = z.object({ word: z.string().min(1).max(GALLERY_MODERATION_LIMITS.termLength) })
const blockBody = z
  .object({
    jobIds: z.array(z.string().uuid()).max(MAX_GALLERY_REMOVAL).optional(),
    userIds: z.array(z.string().uuid()).max(MAX_GALLERY_REMOVAL).optional(),
    email: z.string().trim().email().max(320).optional(),
  })
  .refine((body) => (body.jobIds?.length ?? 0) + (body.userIds?.length ?? 0) > 0 || !!body.email, {
    message: "Name the items, the creators or an email",
  })
const unblockBody = z.object({ userId: z.string().uuid() })
const patternBody = z.object({ pattern: z.string().min(1).max(GALLERY_MODERATION_LIMITS.emailPatternLength) })
const itemsQuery = z.object({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(30),
  type: z.enum(["image", "video", "audio"]).optional(),
  userId: z.string().uuid().optional(),
})

export interface GalleryBannedCreator extends GalleryBannedUser {
  readonly email: string | null
  readonly name: string | null
}

/** Each blocked pattern with how many accounts it matches today. */
async function withMatchCounts(patterns: readonly GalleryBannedEmailPattern[]) {
  return Promise.all(
    patterns.map(async (entry) => {
      const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true }).ilike("email", emailPatternToIlike(entry.pattern))
      return { ...entry, matches: count ?? 0 }
    }),
  )
}

/** Profiles read per request — a long `in` list would not fit the request line. */
const PROFILE_CHUNK = 100

/** The blocked creators with their email and name, for the admin page. */
async function withProfiles(users: readonly GalleryBannedUser[]): Promise<GalleryBannedCreator[]> {
  if (users.length === 0) return []
  const ids = users.map((user) => user.userId)
  const chunks = Array.from({ length: Math.ceil(ids.length / PROFILE_CHUNK) }, (_, i) => ids.slice(i * PROFILE_CHUNK, (i + 1) * PROFILE_CHUNK))
  const answers = await Promise.all(chunks.map((chunk) => supabase.from("profiles").select("id, email, full_name").in("id", chunk)))
  for (const { error } of answers) if (error) console.error("[admin-gallery-moderation] Could not read creator profiles:", error.message)
  const byId = new Map(answers.flatMap(({ data }) => data ?? []).map((profile) => [String(profile.id).toLowerCase(), profile]))
  return users.map((user) => {
    const profile = byId.get(user.userId)
    return { ...user, email: (profile?.email as string | null | undefined) ?? null, name: (profile?.full_name as string | null | undefined) ?? null }
  })
}

function fail(reply: FastifyReply, error: unknown, what: string) {
  if (error instanceof GalleryModerationError) {
    return reply.status(error.code === "busy" ? 409 : 400).send({ error: { code: error.code, message: error.message } })
  }
  console.error(`[admin-gallery-moderation] ${what} failed:`, error)
  return reply.status(500).send({ error: { code: "internal_error", message: `Could not ${what}.` } })
}

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(error) } })
}

/** The owners of these outputs (any job — an admin may block the maker of something already removed). */
async function ownersOf(jobIds: readonly string[]): Promise<string[]> {
  if (jobIds.length === 0) return []
  const { data, error } = await supabase.from("jobs").select("user_id").in("id", [...jobIds])
  if (error) throw new Error(`Could not read the items' creators: ${error.message}`)
  return [...new Set((data ?? []).map((row) => row.user_id as string | null).filter((id): id is string => !!id))]
}

async function userIdForEmail(email: string): Promise<string | null> {
  const pattern = email.replace(/[%_\\]/g, (ch) => `\\${ch}`)
  const { data, error } = await supabase.from("profiles").select("id").ilike("email", pattern).limit(2)
  if (error) throw new Error(`Could not look the email up: ${error.message}`)
  return data && data.length === 1 ? (data[0]!.id as string) : null
}

export async function adminGalleryModerationRoutes(app: FastifyInstance) {
  /**
   * The public gallery exactly as visitors see it — same pages, same
   * moderation — with who made each item, for the admin to act on.
   */
  app.get("/v1/admin/gallery-moderation/items", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = itemsQuery.safeParse(req.query)
    if (!parsed.success) return badRequest(reply, parsed.error)
    try {
      const page = await readGalleryPage({ ...parsed.data, includePrivate: false, moderation: await loadGalleryModeration() })
      const creatorIds = [...new Set(page.rows.map((row) => row.userId).filter((id): id is string => !!id))]
      const creators = new Map((await withProfiles(creatorIds.map((userId) => ({ userId: userId.toLowerCase(), addedAt: null })))).map((c) => [c.userId, c]))
      reply.header("Cache-Control", "private, no-store")
      return reply.send({
        data: page.rows.map(({ item, userId }) => {
          const creator = userId ? creators.get(userId.toLowerCase()) : undefined
          return { ...item, creator: userId ? { userId, email: creator?.email ?? null, name: creator?.name ?? null } : null }
        }),
        nextCursor: page.nextCursor,
        ...(page.totalCount !== null ? { totalCount: page.totalCount } : {}),
      })
    } catch (error) {
      return fail(reply, error, "read the gallery")
    }
  })

  app.get("/v1/admin/gallery-moderation", { preHandler: requireAdmin }, async (_req, reply) => {
    try {
      const [words, users, patterns] = await Promise.all([readGalleryWords(), readGalleryBannedUsers(), readGalleryEmailPatterns()])
      return reply.send({
        words,
        bannedUsers: await withProfiles(users),
        emailPatterns: await withMatchCounts(patterns),
        limits: GALLERY_MODERATION_LIMITS,
        filling: wordsBeingFilled(),
      })
    } catch (error) {
      return fail(reply, error, "read the gallery rules")
    }
  })

  /** Add a banned word; its translations and exceptions are suggested automatically. */
  app.post("/v1/admin/gallery-moderation/words", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = addWordBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)
    try {
      checkTerm(parsed.data.word)
      // Before the write, so the list is never held while the model thinks.
      const suggestions = await suggestForBannedWord(parsed.data.word, { language: parsed.data.language })
      const words = await addGalleryWord(req.userId!, parsed.data.word, suggestions ?? { translations: [], exceptions: [] })
      return reply.send({ words, suggested: suggestions !== null })
    } catch (error) {
      return fail(reply, error, "add the word")
    }
  })

  /**
   * Import a list of banned words at once. They are added straight away;
   * their translations and suggested allowed phrases arrive in the background.
   * Words that cannot be stored (blank, too long) are skipped and named back.
   */
  app.post("/v1/admin/gallery-moderation/words/import", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = importBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)
    const usable: string[] = []
    const skipped: string[] = []
    for (const raw of parsed.data.words) {
      try {
        usable.push(checkTerm(raw))
      } catch {
        if (raw.trim() !== "") skipped.push(raw.trim().slice(0, 80))
      }
    }
    if (usable.length === 0) {
      return reply.status(400).send({ error: { code: "empty_word", message: "None of these words can be stored." }, skipped })
    }
    try {
      const before = new Set((await readGalleryWords()).map((entry) => entry.word))
      const words = await addGalleryWords(req.userId!, usable)
      const added = words.filter((entry) => !before.has(entry.word)).map((entry) => entry.word)
      void fillSuggestionsInBackground(req.userId!, added, parsed.data.language)
      return reply.send({ words, added: added.length, skipped, filling: wordsBeingFilled() })
    } catch (error) {
      return fail(reply, error, "import the words")
    }
  })

  /** Add or remove a word's translations and exceptions. */
  app.patch("/v1/admin/gallery-moderation/words", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = editWordBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)
    const { word, ...edit } = parsed.data
    try {
      return reply.send({ words: await editGalleryWord(req.userId!, word, edit) })
    } catch (error) {
      return fail(reply, error, "change the word")
    }
  })

  app.post("/v1/admin/gallery-moderation/words/remove", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = removeWordBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)
    try {
      return reply.send({ words: await removeGalleryWord(req.userId!, parsed.data.word) })
    } catch (error) {
      return fail(reply, error, "remove the word")
    }
  })

  /** Block creators: by the gallery items they made, by id, or by email. */
  app.post("/v1/admin/gallery-moderation/creators", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = blockBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)
    try {
      const fromEmail = parsed.data.email ? await userIdForEmail(parsed.data.email) : null
      if (parsed.data.email && !fromEmail) {
        return reply.status(404).send({ error: { code: "user_not_found", message: "No account has that email." } })
      }
      const userIds = [...(await ownersOf(parsed.data.jobIds ?? [])), ...(parsed.data.userIds ?? []), ...(fromEmail ? [fromEmail] : [])]
      if (userIds.length === 0) {
        return reply.status(404).send({ error: { code: "user_not_found", message: "Those items have no creator to block." } })
      }
      const users = await blockGalleryCreators(req.userId!, userIds)
      return reply.send({ bannedUsers: await withProfiles(users), blocked: new Set(userIds.map((id) => id.toLowerCase())).size })
    } catch (error) {
      return fail(reply, error, "block the creators")
    }
  })

  /** Block every account whose email matches a pattern — the ones there now and the ones made later. */
  app.post("/v1/admin/gallery-moderation/creators/patterns", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = patternBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)
    try {
      return reply.send({ emailPatterns: await withMatchCounts(await addGalleryEmailPattern(req.userId!, parsed.data.pattern)) })
    } catch (error) {
      return fail(reply, error, "block the pattern")
    }
  })

  app.post("/v1/admin/gallery-moderation/creators/patterns/remove", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = patternBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)
    try {
      return reply.send({ emailPatterns: await withMatchCounts(await removeGalleryEmailPattern(req.userId!, parsed.data.pattern)) })
    } catch (error) {
      return fail(reply, error, "unblock the pattern")
    }
  })

  app.post("/v1/admin/gallery-moderation/creators/remove", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = unblockBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)
    try {
      return reply.send({ bannedUsers: await withProfiles(await unblockGalleryCreator(req.userId!, parsed.data.userId)) })
    } catch (error) {
      return fail(reply, error, "unblock the creator")
    }
  })
}
