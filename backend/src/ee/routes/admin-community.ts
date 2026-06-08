import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { publishListing } from "../services/community/publish.js"
import { purgeCommunityListingBlobs } from "../services/community/asset-lifecycle.js"
import type { EntityType } from "../lib/community-entity-adapters.js"

const ENTITY_TABLE: Record<EntityType, string> = { character: "characters", location: "locations", object: "objects", creature: "creatures" }

const publishBody = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  category: z.string().max(60).optional(),
  style: z.string().max(60).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  attestation: z.literal(true),
  likenessAttestation: z.boolean().optional(),
})

function bad(reply: FastifyReply, message: string) {
  return reply.status(400).send({ error: { code: "validation_error", message } })
}

export async function adminCommunityRoutes(app: FastifyInstance) {
  app.post<{ Params: { entityType: string; id: string } }>(
    "/v1/admin/community/:entityType/:id/publish",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { entityType, id } = req.params
      if (!["character", "location", "object", "creature"].includes(entityType)) return bad(reply, "Invalid entityType")
      const parsed = publishBody.safeParse(req.body)
      if (!parsed.success) return bad(reply, parsed.error.issues[0]?.message ?? "Invalid request")
      const body = parsed.data
      if (entityType === "character" && body.likenessAttestation !== true) {
        return bad(reply, "likenessAttestation is required for characters")
      }
      const table = ENTITY_TABLE[entityType as EntityType]
      const { data: row } = await supabase.from(table).select("*").eq("id", id).eq("user_id", req.userId!).single()
      if (!row) return reply.status(404).send({ error: { code: "not_found", message: "Source not found" } })
      try {
        const res = await publishListing({
          entityType: entityType as EntityType,
          sourceRow: row as Record<string, unknown> & { id: string },
          creatorId: req.userId!,
          title: body.title,
          description: body.description ?? null,
          category: body.category ?? null,
          style: body.style ?? null,
          tags: body.tags ?? [],
          likenessAttestation: body.likenessAttestation ?? false,
        })
        return reply.send({ slug: res.slug, id: res.id })
      } catch (e) {
        return reply.status(500).send({ error: { code: "publish_failed", message: (e as Error).message } })
      }
    },
  )

  app.delete<{ Params: { id: string } }>(
    "/v1/admin/community/listings/:id",
    { preHandler: requireAdmin },
    async (req, reply) => {
      await supabase.from("community_listings").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", req.params.id)
      await purgeCommunityListingBlobs(req.params.id)
      return reply.send({ ok: true })
    },
  )

  app.get<{ Params: { entityType: string; id: string } }>(
    "/v1/admin/community/by-source/:entityType/:id",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { entityType, id } = req.params
      if (!["character", "location", "object", "creature"].includes(entityType)) return bad(reply, "Invalid entityType")
      const { data } = await supabase
        .from("community_listings")
        .select("id, slug, entity_type, title, is_active, is_listed, clone_count, favorite_count, created_at, updated_at")
        .eq("source_id", id)
        .eq("creator_id", req.userId!)
        .maybeSingle()
      return reply.send({ data: data ?? null })
    },
  )

  app.get("/v1/admin/community/reports", { preHandler: requireAdmin }, async (_req, reply) => {
    const { data } = await supabase
      .from("community_listing_reports")
      .select("*, community_listings:listing_id(id, slug, title, entity_type)")
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
    return reply.send({ data: data ?? [] })
  })

  app.post<{ Params: { id: string } }>(
    "/v1/admin/community/listings/:id/takedown",
    { preHandler: requireAdmin },
    async (req, reply) => {
      await supabase.from("community_listings").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", req.params.id)
      await supabase.from("community_listing_reports").update({ resolved_at: new Date().toISOString(), resolved_by: req.userId! }).eq("listing_id", req.params.id).is("resolved_at", null)
      await purgeCommunityListingBlobs(req.params.id)
      return reply.send({ ok: true })
    },
  )
}
