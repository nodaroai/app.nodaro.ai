import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { requireAdmin } from "../middleware/require-admin.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { NODE_REGISTRY } from "../../lib/node-registry.js"
import { MODEL_CATALOG, LLM_MODELS } from "@nodaro/shared"
import { runtimeSurfaceProfile } from "../../lib/surface-profile.js"
import {
  availabilityOverride,
  saveAvailabilityOverride,
  GATEABLE_NODE_TYPES,
  GATEABLE_MODEL_IDS,
  type AvailabilityKind,
} from "../../lib/availability-override.js"

/**
 * Admin node/model availability (B5) — the runtime layer over the deployment
 * surface profile's factory set. GET returns the full gateable universe with
 * each id's factory state, current effective state, and whether a runtime
 * override is active; PUT stores a full enabled-set (or null = reset to
 * factory). The enforcement itself lives in lib/surface-deny.ts — these
 * routes only read/write the override.
 */

const putBody = z.object({
  kind: z.enum(["nodes", "models"]),
  /** Full enabled set; null resets to the factory (profile) state. */
  enabled: z.union([z.array(z.string()), z.null()]),
})

/** Factory availability (profile layer only — ignores any active override). */
function factoryEnabled(kind: AvailabilityKind, id: string): boolean {
  const { allow, deny } = runtimeSurfaceProfile()[kind]
  if (deny.includes(id)) return false
  if (allow.length) return allow.includes(id)
  return true
}

export async function adminAvailabilityRoutes(app: FastifyInstance) {
  app.get("/v1/admin/availability", { preHandler: requireAdmin }, async (_req, reply) => {
    const nodeOverride = availabilityOverride("nodes")
    const modelOverride = availabilityOverride("models")

    const nodes = NODE_REGISTRY.filter((n) => GATEABLE_NODE_TYPES.has(n.type)).map((n) => ({
      id: n.type,
      label: n.label,
      category: n.category,
      factoryEnabled: factoryEnabled("nodes", n.type),
      enabled: nodeOverride ? nodeOverride.has(n.type) : factoryEnabled("nodes", n.type),
    }))

    const models = [
      ...Object.entries(MODEL_CATALOG).map(([id, entry]) => ({
        id,
        label: (entry as { label?: string }).label ?? id,
        category: "generation",
      })),
      ...LLM_MODELS.map((m) => ({ id: m.id, label: m.displayName, category: "llm" })),
    ]
      .filter((m) => GATEABLE_MODEL_IDS.has(m.id))
      .map((m) => ({
        ...m,
        factoryEnabled: factoryEnabled("models", m.id),
        enabled: modelOverride ? modelOverride.has(m.id) : factoryEnabled("models", m.id),
      }))

    return reply.send({
      nodes: { items: nodes, overridden: nodeOverride !== null },
      models: { items: models, overridden: modelOverride !== null },
    })
  })

  app.put("/v1/admin/availability", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = putBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "kind ('nodes'|'models') and enabled (string[] | null) required" },
      })
    }
    try {
      await saveAvailabilityOverride(parsed.data.kind, parsed.data.enabled)
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to save availability override")
    }
    return reply.send({ ok: true, overridden: parsed.data.enabled !== null })
  })
}
