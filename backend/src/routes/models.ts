import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { listModels, groupByKindAndFamily, MODEL_RECOMMENDATIONS, MODEL_CATALOG, type ModelKind, type ModelMode } from "@nodaro/shared"
import { projectModel } from "../lib/mcp/tools/models.js"
import { isModelDenied } from "../lib/surface-deny.js"
import { loadChargedPrices } from "../lib/pricing/charged-prices.js"
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
      "tts", "music", "sfx", "stt", "voice-design",
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

    // Each model under ITS OWN kind, then by family — the shared envelope the
    // MCP tool renders too (a mixed vendor appears once per kind, #1332).
    const prices = await loadChargedPrices()
    const sections = groupByKindAndFamily(filtered).map(({ kind: k, families }) => ({
      kind: k,
      families: families.map(({ family: fam, models }) => ({ family: fam, models: models.map((m) => projectModel(m, prices)) })),
    }))

    const allRecs = [...MODEL_RECOMMENDATIONS]
    const recommendations = kind
      ? allRecs.filter((r) => r.modelIds.some((id) => MODEL_CATALOG[id]?.kind === kind))
      : allRecs

    // Public + read-only: cache generously. The prices are the admin's and
    // change rarely; the Run button reads them live when it matters.
    reply.header("Cache-Control", "public, max-age=300")
    return reply.send({ sections, recommendations, totalModels: filtered.length })
  })
}
