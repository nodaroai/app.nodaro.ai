import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { checkIsAdmin } from "../lib/admin-check.js"
import { formatZodError } from "../lib/zod-error.js"
import { clientNetworkHash } from "../lib/client-address.js"
import { OWNER_VIEW_MODERATION, loadGalleryModeration } from "../lib/gallery-moderation.js"
import { readGalleryPage, type GalleryPage } from "../lib/gallery-listing.js"
import { MAX_GALLERY_REMOVAL, removeFromGallery } from "../lib/gallery-removal.js"
import { listFavoriteJobIds, toggleGalleryFavorite } from "../lib/gallery-favorites.js"
import { requireAnyAppScope, requireAppScope } from "../lib/scope-prehandler.js"
import { sendInternalError } from "../lib/http-errors.js"
import { TRASHED_JOB_COLUMN } from "../lib/public-job-data.js"

// ---- Zod Schemas ----

const reportBody = z.object({
  jobId: z.string().uuid(),
  reason: z.enum(["inappropriate", "copyright", "spam", "other"]),
  details: z.string().max(1000).optional(),
})

const favoriteBody = z.object({
  jobId: z.string().uuid(),
})

const adminDeleteParams = z.object({
  jobId: z.string().uuid(),
})

const adminBulkRemoveBody = z.object({
  jobIds: z.array(z.string().uuid()).min(1).max(MAX_GALLERY_REMOVAL),
})

export async function galleryRoutes(app: FastifyInstance) {
  /**
   * GET /v1/gallery - Public gallery of completed outputs
   *
   * Query params:
   *   cursor - ISO timestamp cursor for pagination (completed_at of last item)
   *   limit  - items per page (default 20, max 50)
   *   type   - optional filter: "image" | "video" | "audio"
   *   userId - optional: filter to only this user's items
   *   favoritesOnly - optional: "true" narrows YOUR OWN items (your userId,
   *                   signed in) to the ones you favorited; anyone else is
   *                   refused (401 anonymous, 403 another person or no userId)
   */
  app.get("/v1/gallery", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>
    const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? "20", 10) || 20))
    const typeFilter = query.type as string | undefined
    const cursor = query.cursor as string | undefined
    const userIdFilter = query.userId as string | undefined
    const favoritesOnly = query.favoritesOnly === "true"

    // `force_private` (jobs.is_public = false) is DISCOVERY-only: it keeps an
    // output out of the public gallery, it never hides it from its own
    // creator — /v1/jobs, RLS (032), and MCP `browse_gallery scope=mine` all
    // already treat it that way; this route was the one surface conflating
    // "not discoverable" with "not visible to its owner" ("My items only"
    // hid every force_private generation from the person who made it). When
    // the AUTHENTICATED caller is the requested user, drop the is_public
    // gate. req.userId comes from the auth hook's optional-auth path on this
    // public route, so an anonymous or cross-user request can never reach
    // the private view.
    const isOwnerView = !!userIdFilter && !!req.userId && req.userId === userIdFilter

    // Favorites are a person's own bookmarks: `favoritesOnly` is honoured in
    // the owner's view alone. A request for anyone else's favorites — or with
    // no `userId` to say whose — is refused rather than answered with a list
    // that is not what was asked for (it used to show another person's
    // favorited public items to anyone who asked).
    if (favoritesOnly && !isOwnerView) {
      return req.userId
        ? reply.status(403).send({ error: { code: "forbidden", message: "favoritesOnly lists your own favorites: send your own userId" } })
        : reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    // The owner view holds the caller's private work and skips the gallery's
    // moderation — it is theirs alone and must never sit in a shared cache.
    // Set on the answers only, never on a failure.
    const withCacheHeaders = () =>
      reply
        .header("Vary", "Authorization")
        .header("Cache-Control", isOwnerView ? "private, no-store" : "public, max-age=30, stale-while-revalidate=86400")

    // Gallery moderation is discovery-only too: the owner view keeps the
    // built-in word list alone, as before; everyone else gets the admin's
    // blocked creators and banned words as well (lib/gallery-moderation.ts).
    const moderation = isOwnerView ? OWNER_VIEW_MODERATION : await loadGalleryModeration()

    // The owner's favorites, read once, newest first.
    let favoriteJobIds: string[] | null = null
    if (favoritesOnly && userIdFilter) {
      try {
        favoriteJobIds = await listFavoriteJobIds(userIdFilter)
      } catch (error) {
        return sendInternalError(reply, req, error, "Failed to fetch gallery")
      }
      if (favoriteJobIds.length === 0) {
        return withCacheHeaders().send({ data: [], nextCursor: null, totalCount: 0 })
      }
    }

    let page: GalleryPage
    try {
      page = await readGalleryPage({ limit, type: typeFilter, cursor, userId: userIdFilter, favoriteJobIds, includePrivate: isOwnerView, moderation })
    } catch (error) {
      return sendInternalError(reply, req, error, "Failed to fetch gallery")
    }
    const items = page.rows.map((row) => row.item)
    const { nextCursor, totalCount } = page

    return withCacheHeaders().send({
      data: items,
      nextCursor,
      ...(totalCount !== null && { totalCount }),
    })
  })

  /**
   * POST /v1/gallery/favorite - Toggle favorite on a gallery item (auth required)
   *
   * Favorites a job the caller may see (their own, or a public completed one)
   * and answers `{ favorited }`; a favorited job is un-favorited. Another
   * person's private job is a 404. OAuth apps need `assets:write`, like MCP
   * `favorite_asset`.
   */
  app.post("/v1/gallery/favorite", { preHandler: requireAppScope("assets:write") }, async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    const parsed = favoriteBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    try {
      const isAdmin = req.userRole === "admin" || req.userRole === "super_admin"
      const outcome = await toggleGalleryFavorite(req.userId, parsed.data.jobId, { isAdmin })
      if (outcome.kind === "not_found") {
        return reply.status(404).send({ error: { code: "not_found", message: "Gallery item not found" } })
      }
      return reply.send({ favorited: outcome.favorited })
    } catch (error) {
      return sendInternalError(reply, req, error, "Failed to favorite item")
    }
  })

  /**
   * GET /v1/gallery/favorites - Get user's favorite job IDs, newest first (auth
   * required). OAuth apps need `assets:read` (like MCP `list_favorites`) or
   * `jobs:read`, which already shows `favorited` on every job and filters on it.
   */
  app.get("/v1/gallery/favorites", { preHandler: requireAnyAppScope(["assets:read", "jobs:read"]) }, async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    try {
      return reply.send({ data: await listFavoriteJobIds(req.userId) })
    } catch (error) {
      return sendInternalError(reply, req, error, "Failed to fetch favorites")
    }
  })

  /**
   * POST /v1/gallery/report - Report a gallery item
   *
   * Body: { jobId, reason, details? }
   * No auth required — uses IP for rate limiting / dedup.
   */
  app.post("/v1/gallery/report", async (req, reply) => {
    const parsed = reportBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { jobId, reason, details } = parsed.data
    // The reporter's HASHED network, not an address: `reporter_ip` (text) has
    // only ever served the one-hour dedup below, and an anonymous reporter's
    // address is personal data kept forever. One shared value for an address
    // nobody knows — a dedup is still a dedup.
    const reporterIp = clientNetworkHash(req)

    // Check job exists and is public
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id")
      .is(TRASHED_JOB_COLUMN, null)
      .eq("id", jobId)
      .eq("is_public", true)
      .eq("status", "completed")
      .single()

    if (jobError || !job) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Gallery item not found" },
      })
    }

    // Prevent duplicate reports from same IP within 1 hour
    if (reporterIp) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const { data: existing } = await supabase
        .from("gallery_reports")
        .select("id")
        .eq("job_id", jobId)
        .eq("reporter_ip", reporterIp)
        .gte("created_at", oneHourAgo)
        .limit(1)

      if (existing && existing.length > 0) {
        return reply.status(429).send({
          error: { code: "rate_limited", message: "You already reported this item recently" },
        })
      }
    }

    const { error: insertError } = await supabase
      .from("gallery_reports")
      .insert({
        job_id: jobId,
        reason,
        details: details ?? null,
        reporter_ip: reporterIp,
      })

    if (insertError) {
      console.error("[gallery] Report insert failed:", insertError)
      return reply.status(500).send({ error: "Failed to submit report" })
    }

    return reply.send({ success: true, message: "Report submitted" })
  })

  /**
   * DELETE /v1/gallery/:jobId - Admin soft-delete from gallery
   *
   * Sets is_public = false (does not delete the job).
   */
  app.delete<{ Params: { jobId: string } }>("/v1/gallery/:jobId", async (req, reply) => {
    const paramsResult = adminDeleteParams.safeParse(req.params)
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: paramsResult.error.issues[0]?.message ?? "Invalid job ID",
        },
      })
    }

    const { jobId } = paramsResult.data

    // Use authenticated user's ID from JWT, NOT body-supplied userId
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const isAdmin = await checkIsAdmin(req.userId)
    if (!isAdmin) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "Only admins can remove gallery items" },
      })
    }

    try {
      await removeFromGallery([jobId])
    } catch (error) {
      console.error("[gallery] Admin delete failed:", error)
      return reply.status(500).send({ error: "Failed to remove item from gallery" })
    }

    return reply.send({ success: true, message: "Item removed from gallery" })
  })

  /**
   * POST /v1/gallery/remove - Admin bulk soft-delete from gallery
   *
   * Body: { jobIds } (1–100). Same effect as DELETE /v1/gallery/:jobId on each.
   */
  app.post("/v1/gallery/remove", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    if (!(await checkIsAdmin(req.userId))) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "Only admins can remove gallery items" },
      })
    }

    const parsed = adminBulkRemoveBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    try {
      const { removed } = await removeFromGallery(parsed.data.jobIds)
      return reply.send({ success: true, removed })
    } catch (error) {
      console.error("[gallery] Admin bulk remove failed:", error)
      return reply.status(500).send({ error: "Failed to remove items from gallery" })
    }
  })
}
