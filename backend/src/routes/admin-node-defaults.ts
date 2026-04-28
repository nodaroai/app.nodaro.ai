import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { invalidateNodeDefaultsCache } from "../lib/node-defaults-cache.js"
import {
  NODE_DEFAULT_TYPES,
  validateProviderForNodeType,
  type NodeDefaultType,
} from "@nodaro/shared"

const upsertBody = z.object({
  provider: z.string().min(1),
  qualityLevel: z.enum(["low", "mid", "high"]).nullable().optional(),
  aspectRatio: z.enum(["auto", "1:1", "4:3", "3:4", "16:9", "9:16"]).nullable().optional(),
})

function isKnownNodeType(value: string): value is NodeDefaultType {
  return (NODE_DEFAULT_TYPES as readonly string[]).includes(value)
}

export async function adminNodeDefaultsRoutes(app: FastifyInstance) {
  // GET /v1/admin/node-defaults — list all rows (no cache, fresh read)
  app.get(
    "/v1/admin/node-defaults",
    { preHandler: requireAdmin },
    async (_req, reply) => {
      const { data, error } = await supabase
        .from("node_defaults")
        .select("*")
        .order("node_type", { ascending: true })
      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }
      return { defaults: data ?? [] }
    },
  )

  // PATCH /v1/admin/node-defaults/:nodeType — upsert a single row
  app.patch<{ Params: { nodeType: string } }>(
    "/v1/admin/node-defaults/:nodeType",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { nodeType } = req.params
      if (!isKnownNodeType(nodeType)) {
        return reply.status(400).send({
          error: { code: "validation_error", message: `unknown node_type: ${nodeType}` },
        })
      }

      const parsed = upsertBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.issues[0]?.message ?? "invalid body",
          },
        })
      }

      const { provider, qualityLevel, aspectRatio } = parsed.data
      const validation = validateProviderForNodeType(nodeType, provider)
      if (validation) {
        return reply.status(400).send({
          error: { code: "validation_error", message: validation },
        })
      }

      const userId = req.userId ?? null

      const { error } = await supabase.from("node_defaults").upsert(
        {
          node_type: nodeType,
          provider,
          quality_level: qualityLevel ?? null,
          aspect_ratio: aspectRatio ?? null,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "node_type" },
      )

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      invalidateNodeDefaultsCache()
      return { ok: true }
    },
  )

  // DELETE /v1/admin/node-defaults/:nodeType — clear an admin override
  app.delete<{ Params: { nodeType: string } }>(
    "/v1/admin/node-defaults/:nodeType",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { nodeType } = req.params
      const { error } = await supabase
        .from("node_defaults")
        .delete()
        .eq("node_type", nodeType)
      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }
      invalidateNodeDefaultsCache()
      return { ok: true }
    },
  )
}
