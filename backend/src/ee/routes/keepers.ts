import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { checkIsAdmin } from "../../lib/admin-check.js"
import { rejectProgrammaticAuth } from "../../lib/api-auth-mode.js"
import { PERSONAL_SPACE_DISABLED_ERROR } from "../../lib/default-project.js"
import { formatZodError } from "../../lib/zod-error.js"
import { requireAppScope } from "../../lib/scope-prehandler.js"
import {
  KEEPER_CATALOG_CATEGORY_MAX,
  KEEPER_CATALOG_LIMIT_MAX,
  KEEPER_CATALOG_SORT_MAX,
  KEEPER_KINDS,
  copyKeeper,
  listKeeperCatalog,
  setKeeperCatalog,
  type KeeperKind,
} from "../lib/keepers-store.js"

/**
 * Nodaro Keepers — the shared catalog of characters, creatures, locations and
 * objects (`ee/lib/keepers-store.ts` holds every read and write; migration
 * 566). Registered on the multi-user editions (Business, Cloud), beside the
 * community sharing it reuses the copy rule of.
 *
 *   GET  /v1/keepers/catalog                 — PUBLIC (no credential, like
 *        `GET /v1/node-presets/factory`): the shelf, display fields only.
 *        Rate-limited per address and cacheable for a minute, as a public
 *        listing that costs up to seven queries a page should be.
 *   POST /v1/keepers/catalog/:kind/:id/copy  — signed in: the caller's own copy
 *        of a shelf row (made once per caller and source; no credits; the
 *        files count against the caller's storage).
 *   PUT  /v1/<kinds>/:id/catalog             — admin only, on their own rows:
 *        put a row on the shelf or take it off. A first-party session or the
 *        admin's personal token; never an OAuth app token.
 */

const kindParam = z.enum(KEEPER_KINDS)
const idParam = z.string().uuid()

const catalogQuery = z.object({
  kind: kindParam.optional(),
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().positive().max(KEEPER_CATALOG_LIMIT_MAX).optional(),
})

const copyParams = z.object({ kind: kindParam, id: idParam })

const setCatalogBody = z.object({
  catalog: z.boolean(),
  sort: z.number().int().min(-KEEPER_CATALOG_SORT_MAX).max(KEEPER_CATALOG_SORT_MAX).optional(),
  category: z.string().max(KEEPER_CATALOG_CATEGORY_MAX).nullable().optional(),
})

const ADMIN_ONLY_MSG = "Only a platform admin, signed in or with a personal token, can change the Keepers shelf."

/** The public shelf: one address may turn this many pages a minute (an unauthenticated listing of up to seven queries). */
const SHELF_RATE_LIMIT = { rateLimit: { max: 60, timeWindow: "1 minute" } }
/** How long a shelf page may be served from a cache — an admin's change shows within this. */
const SHELF_CACHE_SECONDS = 60

/** The plural path segment of each kind — the kind's own routes' prefix (`/v1/characters`, …). */
const PATH_BY_KIND: Readonly<Record<KeeperKind, string>> = {
  character: "characters",
  creature: "creatures",
  location: "locations",
  object: "objects",
}

/** Registers the three Keepers routes above on `app`. */
export async function keeperRoutes(app: FastifyInstance) {
  app.get("/v1/keepers/catalog", { config: SHELF_RATE_LIMIT }, listCatalog)
  app.post("/v1/keepers/catalog/:kind/:id/copy", { preHandler: requireAppScope("assets:write") }, copyFromCatalog)
  // The whole plugin is registered on the multi-user editions (app.ts), the
  // very ones that have an admin, so no edition gate is needed here.
  for (const kind of KEEPER_KINDS) {
    app.put(`/v1/${PATH_BY_KIND[kind]}/:id/catalog`, setCatalogOf(kind))
  }
}

// ── The shelf (public) ────────────────────────────────────────────────────
async function listCatalog(req: FastifyRequest, reply: FastifyReply) {
  const parsed = catalogQuery.safeParse(req.query)
  if (!parsed.success) {
    return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
  }
  const result = await listKeeperCatalog(parsed.data)
  if ("error" in result) {
    if (result.error === "invalid_cursor") {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid cursor" } })
    }
    req.log.error({ message: result.message }, "[keepers] catalog read failed")
    return reply.status(500).send({ error: { code: "internal_error", message: "Failed to read the catalog" } })
  }
  reply.header("Cache-Control", `public, max-age=${SHELF_CACHE_SECONDS}`)
  return result
}

// ── Using one: a copy in the caller's account ────────────────────────────
async function copyFromCatalog(req: FastifyRequest, reply: FastifyReply) {
  const userId = req.userId
  if (!userId) {
    return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
  }
  const parsed = copyParams.safeParse(req.params)
  if (!parsed.success) {
    return reply.status(400).send({ error: { code: "validation_error", message: "Invalid kind or id" } })
  }
  const result = await copyKeeper(parsed.data.kind, parsed.data.id, userId)
  if ("error" in result) {
    switch (result.error) {
      case "not_found":
        return reply.status(404).send({ error: { code: "not_found", message: "Not in the catalog" } })
      case "storage_limit_exceeded":
        // The same answer as the community clone (routes/community.ts).
        return reply.status(413).send({ error: { code: "storage_limit_exceeded", message: "Storage limit exceeded" } })
      case "personal_space_disabled":
        return reply.status(403).send({ error: PERSONAL_SPACE_DISABLED_ERROR })
      default:
        req.log.error({ message: result.message }, "[keepers] copy failed")
        return reply.status(500).send({ error: { code: "internal_error", message: "Failed to copy the item" } })
    }
  }
  return { id: result.id, name: result.name, kind: parsed.data.kind, created: result.created }
}

// ── Marking a row (admin) ────────────────────────────────────────────────
/** The handler of `PUT /v1/<kind's path>/:id/catalog`: who may, before what — a non-admin learns nothing about the body. */
function setCatalogOf(kind: KeeperKind) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    if (rejectProgrammaticAuth(req, reply, ADMIN_ONLY_MSG, { allowPersonalToken: true })) return
    if (!(await checkIsAdmin(userId))) {
      return reply.status(403).send({ error: { code: "forbidden", message: ADMIN_ONLY_MSG } })
    }
    const idParsed = idParam.safeParse((req.params as { id?: unknown }).id)
    if (!idParsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid id" } })
    }
    const bodyParsed = setCatalogBody.safeParse(req.body)
    if (!bodyParsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(bodyParsed.error) } })
    }
    const result = await setKeeperCatalog(kind, idParsed.data, userId, bodyParsed.data)
    if ("error" in result) {
      if (result.error === "not_found") {
        return reply.status(404).send({ error: { code: "not_found", message: "Not one of your items" } })
      }
      req.log.error({ message: result.message }, "[keepers] set catalog failed")
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to update the item" } })
    }
    return { id: result.id, kind, catalog: result.catalog, sort: result.sort, category: result.category }
  }
}
