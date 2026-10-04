import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { formatZodError } from "../../lib/zod-error.js"
import { MAX_GALLERY_REMOVAL } from "../../lib/gallery-removal.js"
import { GALLERY_MODERATION_LIMITS, type GalleryBannedUser } from "../../lib/gallery-moderation-settings.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { suggestForBannedWord } from "../lib/gallery-word-suggestions.js"
import {
  GalleryModerationError,
  addGalleryWord,
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

const addWordBody = z.object({ word: term })
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

export interface GalleryBannedCreator extends GalleryBannedUser {
  readonly email: string | null
  readonly name: string | null
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
  app.get("/v1/admin/gallery-moderation", { preHandler: requireAdmin }, async (_req, reply) => {
    try {
      const [words, users] = await Promise.all([readGalleryWords(), readGalleryBannedUsers()])
      return reply.send({ words, bannedUsers: await withProfiles(users), limits: GALLERY_MODERATION_LIMITS })
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
      const suggestions = await suggestForBannedWord(parsed.data.word)
      const words = await addGalleryWord(req.userId!, parsed.data.word, suggestions ?? { translations: [], exceptions: [] })
      return reply.send({ words, suggested: suggestions !== null })
    } catch (error) {
      return fail(reply, error, "add the word")
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
