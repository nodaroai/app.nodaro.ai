import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import type { CommunityCard } from "@nodaro/shared"
import { supabase } from "../../lib/supabase.js"
import { cloneListing } from "../services/community/clone.js"
import { requireAppScope } from "../../lib/scope-prehandler.js"
import type { EntityType } from "../lib/community-entity-adapters.js"
import { decodeCommunityCursor, encodeCommunityCursor } from "./community-cursor.js"

const PUBLIC_COLS = "id, entity_type, creator_display_name, slug, title, description, category, style, tags, preview_media_url, preview_images, clone_count, favorite_count, created_at"

function auth(req: FastifyRequest, reply: FastifyReply): string | null {
  if (!req.userId) { reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } }); return null }
  return req.userId
}

export async function communityRoutes(app: FastifyInstance) {
  app.get("/v1/community/browse", async (req, reply) => {
    if (!auth(req, reply)) return
    const q = req.query as Record<string, string | undefined>
    const limit = Math.min(50, Math.max(1, parseInt(q.limit ?? "20", 10) || 20))
    let query = supabase.from("community_listings").select(PUBLIC_COLS).eq("is_listed", true).eq("is_active", true)
    if (q.entityType) query = query.eq("entity_type", q.entityType)
    if (q.category) query = query.eq("category", q.category)
    if (q.q) query = query.textSearch("search_vector", q.q, { type: "websearch" })
    const sort = q.sort === "popular" ? "popular" : "newest"
    // Decode + strict-validate the base64 {count,createdAt,id} cursor (rejects
    // filter-injection in the .or() interpolation below), then apply a keyset filter.
    const cursor = decodeCommunityCursor(q.cursor)
    if (sort === "popular") {
      query = query.order("clone_count", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false })
      if (cursor) {
        query = query.or(`clone_count.lt.${cursor.count},and(clone_count.eq.${cursor.count},created_at.lt.${cursor.createdAt}),and(clone_count.eq.${cursor.count},created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
      }
    } else {
      query = query.order("created_at", { ascending: false }).order("id", { ascending: false })
      if (cursor) {
        query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
      }
    }
    const { data } = await query.limit(limit + 1)
    const rows = (data ?? []) as Array<Record<string, unknown>>
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page[page.length - 1]
    const nextCursor = hasMore && last
      ? encodeCommunityCursor({ count: last.clone_count as number, createdAt: last.created_at as string, id: last.id as string })
      : null
    return reply.send({ data: page as unknown as CommunityCard[], nextCursor })
  })

  app.get<{ Params: { slug: string } }>("/v1/community/detail/:slug", async (req, reply) => {
    if (!auth(req, reply)) return
    const { data } = await supabase.from("community_listings").select(PUBLIC_COLS).eq("slug", req.params.slug).eq("is_active", true).single()
    if (!data) return reply.status(404).send({ error: { code: "not_found", message: "Listing not found" } })
    return reply.send({ data: data as unknown as CommunityCard })
  })

  app.post<{ Params: { id: string } }>(
    "/v1/community/listings/:id/clone",
    { preHandler: requireAppScope("assets:write") },
    async (req, reply) => {
      const userId = auth(req, reply); if (!userId) return
      const body = z.object({ entityType: z.enum(["character", "location", "object"]) }).safeParse(req.body)
      if (!body.success) return reply.status(400).send({ error: { code: "validation_error", message: "entityType required" } })
      try {
        const res = await cloneListing({ listingId: req.params.id, entityType: body.data.entityType as EntityType, userId })
        return reply.send(res)
      } catch (e) {
        if ((e as { code?: string }).code === "listing_unavailable") {
          return reply.status(404).send({ error: { code: "not_found", message: "Listing not available" } })
        }
        if ((e as { code?: string }).code === "storage_limit_exceeded") {
          return reply.status(413).send({ error: { code: "storage_limit_exceeded", message: "Storage limit exceeded" } })
        }
        return reply.status(500).send({ error: { code: "clone_failed", message: (e as Error).message } })
      }
    },
  )

  app.post<{ Params: { id: string } }>("/v1/community/listings/:id/favorite", async (req, reply) => {
    const userId = auth(req, reply); if (!userId) return
    const { data: existing } = await supabase.from("community_listing_favorites").select("id").eq("user_id", userId).eq("listing_id", req.params.id).maybeSingle()
    if (existing) { await supabase.from("community_listing_favorites").delete().eq("id", existing.id); return reply.send({ favorited: false }) }
    await supabase.from("community_listing_favorites").insert({ user_id: userId, listing_id: req.params.id })
    return reply.send({ favorited: true })
  })

  app.post<{ Params: { id: string } }>("/v1/community/listings/:id/report", async (req, reply) => {
    const userId = auth(req, reply); if (!userId) return
    const body = z.object({ reason: z.enum(["real_person_no_consent", "inappropriate", "ip_violation", "other"]) }).safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: { code: "validation_error", message: "Invalid reason" } })
    await supabase.from("community_listing_reports").insert({ listing_id: req.params.id, reporter_id: userId, reason: body.data.reason })
    return reply.send({ ok: true })
  })

  app.get("/v1/community/favorites", async (req, reply) => {
    const userId = auth(req, reply); if (!userId) return
    const { data } = await supabase.from("community_listing_favorites").select(`listing:listing_id(${PUBLIC_COLS})`).eq("user_id", userId)
    return reply.send({ data: (data ?? []).map((r) => (r as { listing: unknown }).listing).filter(Boolean) as unknown as CommunityCard[] })
  })
}
