/**
 * Admin → Provider safety: what an admin has changed about provider content
 * filters, per model.
 *
 *   GET /v1/admin/provider-safety   the page's data: every lever, today's value, what is saved, what is locked
 *   PUT /v1/admin/provider-safety   { overrides }: save the whole setting; audit-logged
 *
 * The write takes the platform operator gate: on a deployment-payer instance a
 * customer's identity provider issues the admins, and this setting is about
 * what Nodaro's provider accounts are asked to make. A value looser than today's
 * request is refused unless both a content guard and a result check are
 * registered (lib/content-guard.ts, lib/result-check.ts);
 * `validateProviderSafetySave` holds the rest of the rules.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { looseningAllowed } from "../../lib/provider-safety.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { requirePlatformOperator } from "../middleware/require-platform-operator.js"
import {
  PROVIDER_SAFETY_AUDIT_TARGET,
  ProviderSafetyError,
  providerSafetyView,
  readProviderSafetyRow,
  recordProviderSafetyChange,
  saveProviderSafetyRow,
  validateProviderSafetySave,
} from "../lib/provider-safety-admin.js"

export { PROVIDER_SAFETY_AUDIT_TARGET }

const putBody = z.strictObject({
  overrides: z.record(z.string().min(1), z.record(z.string().min(1), z.union([z.boolean(), z.number(), z.string().min(1)]))),
})

export async function adminProviderSafetyRoutes(app: FastifyInstance) {
  app.get("/v1/admin/provider-safety", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await providerSafetyView() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the provider safety settings")
    }
  })

  app.put("/v1/admin/provider-safety", { preHandler: requirePlatformOperator }, async (req, reply) => {
    const parsed = putBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const overrides = validateProviderSafetySave(parsed.data.overrides, await looseningAllowed())
      const { overrides: before } = await readProviderSafetyRow()
      // Written first and required, so a save can never stand unaudited.
      await recordProviderSafetyChange(req.userId!, "update_provider_safety", before, overrides)
      try {
        await saveProviderSafetyRow(overrides, req.userId!)
      } catch (e) {
        await recordProviderSafetyChange(req.userId!, "update_provider_safety_failed", before, overrides).catch(() => {})
        throw e
      }
      return { data: await providerSafetyView() }
    } catch (e) {
      if (e instanceof ProviderSafetyError) {
        const status = e.code === "loosening_locked" || e.code === "wire_unconfirmed" || e.code === "never_loosen" ? 409 : 400
        return reply.status(status).send({ error: { code: e.code, message: e.message } })
      }
      return sendInternalError(reply, req, e, "Failed to save the provider safety settings")
    }
  })
}
