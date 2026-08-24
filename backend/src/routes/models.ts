import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { listModels, groupByFamily, MODEL_RECOMMENDATIONS, MODEL_CATALOG, type ModelKind, type ModelMode } from "@nodaro/shared"
import { projectModel } from "../lib/mcp/tools/models.js"
import { isModelDenied } from "../lib/surface-deny.js"
import { formatZodError } from "../lib/zod-error.js"

/**
 * GET /v1/models — the REST twin of the MCP `list_models` tool, for plain
 * SDK/HTTP clients (Nodaro Cine's model picker + optimizer badge). Public:
 * model availability is not a secret (same stance as the MCP tool and
 * GET /v1/nodes). Reuses the exact MCP projection — including
 * `doctrineCovered`, the truth flag for "vendor doctrine · real rewrite"
 * badges — so the two surfaces cannot drift.
 */

const modelsQuery = z.object({
  kind: z.enum(["image", "video", "audio"]).optional(),
  mode: z
    .enum([
      "t2i", "i2i", "edit", "upscale", "remove-bg",
      "i2v", "t2v", "v2v", "extend", "motion-transfer", "lip-sync", "video-upscale",
      "tts", "music", "sfx", "stt", "voice-clone", "voice-design",
      "voice-changer", "voice-changer-pro", "isolation", "dubbing", "forced-alignment",
      "video-analysis", "video-audit",
    ])
    .optional(),
  family: z.string().max(100).optional(),
  featuredOnly: z.coerce.boolean().optional(),
})

export async function modelsRoutes(app: FastifyInstance) {
  app.get("/v1/models", async (req, reply) => {
    const parsed = modelsQuery.safeParse(req.query ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    const { kind, mode, family, featuredOnly } = parsed.data

    const filtered = listModels({
      kind: kind as ModelKind | undefined,
      mode: mode as ModelMode | undefined,
      family,
    })
      .filter((m) => !m.mcpHidden)
      .filter((m) => (featuredOnly ? m.featured === true : true))
      // Deployment surface deny (B1): a denied model is invisible in discovery.
      .filter((m) => !isModelDenied(m.id))

    const grouped = groupByFamily(filtered)
    const byKind: Record<ModelKind, Array<{ family: string; models: Record<string, unknown>[] }>> = {
      image: [],
      video: [],
      audio: [],
    }
    for (const { family: fam, models } of grouped) {
      const k = models[0]!.kind
      byKind[k].push({ family: fam, models: models.map(projectModel) })
    }
    const sections = (["image", "video", "audio"] as const)
      .filter((k) => byKind[k].length > 0)
      .map((k) => ({ kind: k, families: byKind[k] }))

    const allRecs = [...MODEL_RECOMMENDATIONS]
    const recommendations = kind
      ? allRecs.filter((r) => r.modelIds.some((id) => MODEL_CATALOG[id]?.kind === kind))
      : allRecs

    // Public + read-only + catalog-static: cache generously.
    reply.header("Cache-Control", "public, max-age=300")
    return reply.send({ sections, recommendations, totalModels: filtered.length })
  })
}
