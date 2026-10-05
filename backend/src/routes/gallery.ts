import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { checkIsAdmin } from "../lib/admin-check.js"
import { formatZodError } from "../lib/zod-error.js"
import { clientNetworkHash } from "../lib/client-address.js"
import { OWNER_VIEW_MODERATION, loadGalleryModeration } from "../lib/gallery-moderation.js"
import { readGalleryPage, type GalleryPage } from "../lib/gallery-listing.js"
import { MAX_GALLERY_REMOVAL, removeFromGallery } from "../lib/gallery-removal.js"

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
   *   favoritesOnly - optional: "true" to show only user's favorites (requires userId)
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

    // Gallery moderation is discovery-only too: the owner view keeps the
    // built-in word list alone, as before; everyone else gets the admin's
    // blocked creators and banned words as well (lib/gallery-moderation.ts).
    const moderation = isOwnerView ? OWNER_VIEW_MODERATION : await loadGalleryModeration()

    // Pre-fetch favorite job IDs if filtering by favorites
    let favoriteJobIds: string[] | null = null
    if (favoritesOnly && userIdFilter) {
      const { data: favs } = await supabase
        .from("gallery_favorites")
        .select("job_id")
        .eq("user_id", userIdFilter)
        .order("created_at", { ascending: false })
      favoriteJobIds = favs?.map((f) => f.job_id) ?? []
      if (favoriteJobIds.length === 0) {
        return reply.send({ data: [], nextCursor: null, totalCount: 0 })
      }
    }

    let page: GalleryPage
    try {
      page = await readGalleryPage({ limit, type: typeFilter, cursor, userId: userIdFilter, favoriteJobIds, includePrivate: isOwnerView, moderation })
    } catch (error) {
      console.error("[gallery] Query failed:", error)
      return reply.status(500).send({ error: "Failed to fetch gallery" })
    }
    const items = page.rows.map((row) => row.item)
    const { nextCursor, totalCount } = page

    // The owner view holds the caller's private work and skips the gallery's
    // moderation — it is theirs alone and must never sit in a shared cache.
    reply.header("Vary", "Authorization")
    reply.header("Cache-Control", isOwnerView ? "private, no-store" : "public, max-age=30, stale-while-revalidate=86400")
    return reply.send({
      data: items,
      nextCursor,
      ...(totalCount !== null && { totalCount }),
    })
  })

  /**
   * POST /v1/gallery/favorite - Toggle favorite on a gallery item (auth required)
   */
  app.post("/v1/gallery/favorite", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    const parsed = favoriteBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { jobId } = parsed.data
    const userId = req.userId

    // Check if already favorited
    const { data: existing } = await supabase
      .from("gallery_favorites")
      .select("id")
      .eq("user_id", userId)
      .eq("job_id", jobId)
      .limit(1)

    if (existing && existing.length > 0) {
      // Remove favorite
      await supabase
        .from("gallery_favorites")
        .delete()
        .eq("user_id", userId)
        .eq("job_id", jobId)
      return reply.send({ favorited: false })
    }

    // Add favorite
    const { error } = await supabase
      .from("gallery_favorites")
      .insert({ user_id: userId, job_id: jobId })

    if (error) {
      console.error("[gallery] Favorite insert failed:", error)
      return reply.status(500).send({ error: "Failed to favorite item" })
    }

    return reply.send({ favorited: true })
  })

  /**
   * GET /v1/gallery/favorites - Get user's favorite job IDs (auth required)
   */
  app.get("/v1/gallery/favorites", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    const { data, error } = await supabase
      .from("gallery_favorites")
      .select("job_id")
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[gallery] Favorites fetch failed:", error)
      return reply.status(500).send({ error: "Failed to fetch favorites" })
    }

    return reply.send({ data: (data ?? []).map((f) => f.job_id) })
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
