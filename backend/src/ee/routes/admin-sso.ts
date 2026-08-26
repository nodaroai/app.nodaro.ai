import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { invalidateAuthCache } from "../../middleware/auth.js"
import { SSO_APP_METADATA_KEY } from "../../lib/sso-linking.js"

/**
 * SAI-6 / H7 — admin de-provisioning for federated (SSO) accounts.
 *
 * Provisioning an SSO user (lib/sso-linking.ts) creates a durable, independent
 * Supabase account whose lifetime is decoupled from the assertion. Before this
 * route there was NO mechanism anywhere to revoke that account's Nodaro access
 * (grep: zero auth.admin.deleteUser / ban_duration), so removing a user from
 * SAI's IdP did nothing on Nodaro — the ex-user kept spending the tenant's
 * prepaid credits.
 *
 * `DELETE /v1/admin/sso/:provider/users/:subject` (admin-only):
 *   - default (mode=ban): bans re-login (GoTrue ban_duration) AND clears the
 *     app_metadata SSO marker, so a still-valid access token is rejected by the
 *     H6 SSO gate (surfaceSsoOnly) on its next verification — immediate
 *     revocation without waiting for JWT expiry. Reversible (a fresh SSO login
 *     re-provisions/links).
 *   - mode=delete: hard-removes the account (auth.admin.deleteUser).
 * Either way, invalidateAuthCache drops the 5-minute token cache so the decision
 * takes effect now, not up to 5 minutes later.
 *
 * Resolution is by the trusted app_metadata marker (provider + sso_subject that
 * sso-linking stamps). A single-tenant SAI instance has a bounded user count, so
 * a paged listUsers scan is fine; the page cap stops a misconfig from looping.
 */

const BAN_DURATION = "876000h" // ~100 years — GoTrue's "permanent ban" idiom (undo: "none")

const paramsSchema = z.object({
  provider: z.string().min(1),
  subject: z.string().min(1),
})
const querySchema = z.object({
  mode: z.enum(["ban", "delete"]).default("ban"),
})

/** Resolve the Supabase user id provisioned from this (provider, subject) via a
 *  bounded scan. Returns null when no such account exists. */
async function findSsoUserId(provider: string, subject: string): Promise<string | null> {
  const perPage = 200
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error || !data?.users?.length) return null
    for (const u of data.users) {
      const meta = (u.app_metadata ?? {}) as Record<string, unknown>
      if (meta[SSO_APP_METADATA_KEY] === provider && meta.sso_subject === subject) return u.id
    }
    if (data.users.length < perPage) return null // last page reached
  }
  return null
}

export async function adminSsoRoutes(app: FastifyInstance): Promise<void> {
  app.delete("/v1/admin/sso/:provider/users/:subject", { preHandler: requireAdmin }, async (req, reply) => {
    const params = paramsSchema.safeParse(req.params)
    const query = querySchema.safeParse(req.query)
    if (!params.success || !query.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid provider / subject / mode" },
      })
    }

    const userId = await findSsoUserId(params.data.provider, params.data.subject)
    if (!userId) {
      return reply.status(404).send({
        error: { code: "not_found", message: "No SSO-provisioned account for that provider/subject." },
      })
    }

    if (query.data.mode === "delete") {
      const { error } = await supabase.auth.admin.deleteUser(userId)
      if (error) {
        req.log.error({ err: error }, "admin/sso de-provision (delete) failed")
        return reply.status(500).send({ error: { code: "internal_error", message: "De-provision failed" } })
      }
    } else {
      // Ban re-login AND clear the SSO marker so the H6 gate rejects a lingering
      // access token on its next verification (nulling a key removes it).
      const { error } = await supabase.auth.admin.updateUserById(userId, {
        ban_duration: BAN_DURATION,
        app_metadata: { [SSO_APP_METADATA_KEY]: null, sso_subject: null },
      })
      if (error) {
        req.log.error({ err: error }, "admin/sso de-provision (ban) failed")
        return reply.status(500).send({ error: { code: "internal_error", message: "De-provision failed" } })
      }
    }

    invalidateAuthCache(userId)
    return reply.send({ ok: true, userId, mode: query.data.mode })
  })
}
