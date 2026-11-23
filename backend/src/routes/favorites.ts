import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import { sendInternalError } from "../lib/http-errors.js"
import { requireAnyAppScope, requireAppScope } from "../lib/scope-prehandler.js"
import { hasScope, type Scope } from "../lib/scopes.js"
import { FAVORITE_KINDS, decodeFavoritesCursor, type FavoriteKind } from "../lib/favorites-cursor.js"
import { readFavoritesPage } from "../lib/favorites-feed.js"
import { canonicalCatalogId, resolveCatalogFavorite } from "../lib/catalog-favorite-ids.js"
import { addCatalogFavorite, listCatalogFavorites, removeCatalogFavorite } from "../lib/catalog-favorites.js"
import "./favorites-docs.js"

/**
 * Favorites for everything a person keeps (migration 688):
 *
 *   GET    /v1/favorites                               every kind, one list, newest first
 *   GET    /v1/favorites/catalog?catalog=              favorite picker options
 *   PUT    /v1/favorites/catalog/:catalog/:optionId    star an option
 *   DELETE /v1/favorites/catalog/:catalog/:optionId    unstar it
 *
 * Owner-only: every read and write is the caller's own (`req.userId`, 401
 * without), and the tables grant nothing to client roles. OAuth scopes are
 * those of each kind's own route: `assets:read` / `assets:write` like the
 * gallery's and the voices' favorites; a preset favorite reads with
 * `presets:read` like `GET /v1/node-presets/favorites`; a job favorite also
 * with `jobs:read`, which shows `favorited` on every job.
 */

/** The scopes that read each kind (any one of them). */
const KIND_READ_SCOPES: Record<FavoriteKind, readonly Scope[]> = {
  job: ["assets:read", "jobs:read"],
  asset: ["assets:read"],
  voice: ["assets:read"],
  preset: ["presets:read"],
  catalog: ["assets:read"],
}

/** Writes are rate limited like the voice and preset favorites. */
const WRITE_LIMIT = { rateLimit: { max: 60, timeWindow: "1 minute" } }

/** Reads are rate limited like the other list routes: a page of the combined list reads every kind's table. */
const READ_LIMIT = { rateLimit: { max: 120, timeWindow: "1 minute" } }

export const listFavoritesQuery = z.object({
  kinds: z
    .string()
    .max(200)
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === "") return undefined
      const kinds = [...new Set(v.split(",").map((k) => k.trim()).filter(Boolean))]
      const unknown = kinds.filter((k) => !(FAVORITE_KINDS as readonly string[]).includes(k))
      if (unknown.length > 0) {
        ctx.addIssue({ code: "custom", message: `Unknown kind: ${unknown.join(", ")} (expected ${FAVORITE_KINDS.join(", ")})` })
        return z.NEVER
      }
      return kinds as FavoriteKind[]
    }),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().max(400).optional(),
})

export const catalogParams = z.object({
  catalog: z.string().min(1).max(64),
  optionId: z.string().min(1).max(200),
})

export const listCatalogQuery = z.object({ catalog: z.string().min(1).max(64).optional() })

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
}

function validationError(reply: FastifyReply, message: string) {
  return reply.status(400).send({ error: { code: "validation_error", message } })
}

function notAvailable(reply: FastifyReply) {
  return reply.status(503).send({ error: { code: "not_available", message: "Favorite picker options are not available on this server yet." } })
}

export async function favoritesRoutes(app: FastifyInstance) {
  // EVERY favorite, newest first, one cursor.
  app.get(
    "/v1/favorites",
    { preHandler: requireAnyAppScope(["assets:read", "presets:read", "jobs:read"]), config: READ_LIMIT },
    async (req, reply) => {
      const userId = req.userId
      if (!userId) return unauthorized(reply)
      const parsed = listFavoritesQuery.safeParse(req.query)
      if (!parsed.success) return validationError(reply, parsed.error.issues[0]?.message ?? "Invalid query")
      const cursor = parsed.data.cursor ? decodeFavoritesCursor(parsed.data.cursor) : null
      if (parsed.data.cursor && !cursor) return validationError(reply, "Invalid cursor")

      // An OAuth app reads only the kinds its grant reads through their own routes:
      // asked for by name, a kind it may not read is refused; by default it is left out.
      const granted = req.appAuthorization?.scopes
      const readable = (kind: FavoriteKind) => !granted || KIND_READ_SCOPES[kind].some((s) => hasScope(granted, s))
      const asked = parsed.data.kinds
      const refused = (asked ?? []).filter((k) => !readable(k))
      if (refused.length > 0) {
        const missing = KIND_READ_SCOPES[refused[0]!][0]!
        return reply.status(403).send({
          error: { code: "insufficient_scope", message: `Missing required scope to read ${refused.join(", ")} favorites: ${missing}`, missingScope: missing },
        })
      }
      const kinds = asked ?? FAVORITE_KINDS.filter(readable)

      try {
        return await readFavoritesPage(userId, kinds, parsed.data.limit, cursor)
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to fetch favorites")
      }
    },
  )

  // The caller's favorite picker options, newest first; one catalog's with `?catalog=`.
  app.get("/v1/favorites/catalog", { preHandler: requireAppScope("assets:read"), config: READ_LIMIT }, async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const parsed = listCatalogQuery.safeParse(req.query)
    if (!parsed.success) return validationError(reply, parsed.error.issues[0]?.message ?? "Invalid query")
    let catalog: string | undefined
    if (parsed.data.catalog) {
      const canonical = canonicalCatalogId(parsed.data.catalog)
      if (!canonical) return validationError(reply, `Unknown catalog "${parsed.data.catalog}"`)
      catalog = canonical
    }
    try {
      return { data: await listCatalogFavorites(userId, catalog) }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to fetch favorites")
    }
  })

  // STAR a picker option (idempotent).
  app.put(
    "/v1/favorites/catalog/:catalog/:optionId",
    { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT },
    async (req, reply) => {
      const userId = req.userId
      if (!userId) return unauthorized(reply)
      const params = catalogParams.safeParse(req.params)
      if (!params.success) return validationError(reply, params.error.issues[0]?.message ?? "Invalid catalog or option")
      const resolved = resolveCatalogFavorite(params.data.catalog, params.data.optionId)
      if (!resolved.ok) return validationError(reply, resolved.message)
      try {
        const outcome = await addCatalogFavorite(userId, resolved.key)
        if (outcome.kind === "not_available") return notAvailable(reply)
        if (outcome.kind === "limit_reached") {
          return reply.status(409).send({ error: { code: "limit_reached", message: "You have reached the most favorite options you can keep. Unstar one first." } })
        }
        return {
          data: {
            catalog: resolved.key.catalog,
            optionId: resolved.key.optionId,
            label: resolved.key.label,
            favorited: true,
            createdAt: outcome.favorite?.createdAt ?? null,
          },
        }
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to add favorite")
      }
    },
  )

  // UNSTAR a picker option (idempotent: removing one that is not there succeeds).
  app.delete(
    "/v1/favorites/catalog/:catalog/:optionId",
    { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT },
    async (req, reply) => {
      const userId = req.userId
      if (!userId) return unauthorized(reply)
      const params = catalogParams.safeParse(req.params)
      if (!params.success) return validationError(reply, params.error.issues[0]?.message ?? "Invalid catalog or option")
      // The stored spelling when the option still exists; as given when its catalog
      // has since dropped it (its star can always be taken back).
      const resolved = resolveCatalogFavorite(params.data.catalog, params.data.optionId)
      const catalog = resolved.ok ? resolved.key.catalog : (canonicalCatalogId(params.data.catalog) ?? params.data.catalog)
      const optionId = resolved.ok ? resolved.key.optionId : params.data.optionId
      try {
        const outcome = await removeCatalogFavorite(userId, catalog, optionId)
        if (outcome.kind === "not_available") return notAvailable(reply)
        return { data: { catalog, optionId, favorited: false } }
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to remove favorite")
      }
    },
  )
}
