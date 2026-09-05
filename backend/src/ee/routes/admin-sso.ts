import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { invalidateAuthCache } from "../../middleware/auth.js"
import { SSO_APP_METADATA_KEY } from "../../lib/sso-linking.js"
import { deploymentPayerId } from "../../lib/deployment-payer.js"

/**
 * SAI-6 / H7 — admin de-provisioning for federated (SSO) accounts.
 *
 * Provisioning an SSO user (lib/sso-linking.ts) creates a durable, independent
 * Supabase account whose lifetime is decoupled from the assertion. Before this
 * route there was NO mechanism anywhere to revoke that account's Nodaro access
 * (grep: zero auth.admin.deleteUser / ban_duration), so removing a user from
 * the deployment's IdP did nothing on Nodaro — the ex-user kept spending
 * the tenant's prepaid credits.
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
 * sso-linking stamps). A single-tenant deployment has a bounded user count, so
 * a paged listUsers scan is fine; the page cap stops a misconfig from looping.
 *
 * ONE ACCOUNT IS OUT OF REACH (D15.2). Since the deployment's BILLING ACCOUNT
 * became an identity of the customer's own provider, it carries the same marker
 * every other federated user does — so without the guard below this route would
 * de-provision the account that holds the deployment's credits, on an admin
 * role the customer's own IdP hands out. `mode=ban` locks the payer out through
 * GoTrue itself — once the auth cache is invalidated, EVERY token for a banned
 * user fails `supabase.auth.getUser`, including the break-glass password
 * session that exists for exactly this kind of outage. (The marker clear that
 * rides along is irrelevant for this one uuid: `middleware/auth.ts:477` exempts
 * the payer from H6, so that gate never reads its marker.) `mode=delete` would
 * destroy the account the pool, the allowances and the card on file hang off —
 * and it is this repo's only `auth.admin.deleteUser` call site, so the next
 * boot would fail on an unresolvable `billing.payerAccount`. The refusal is exactly one uuid
 * wide — `deploymentPayerId()`, resolved at boot from operator-owned surface
 * config and null on mainline — so every other federated account stays
 * de-provisionable, which is what this route exists for.
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

    // D15.2 — the money account, whichever mode. Distinct code: "not this
    // account" is a different fact from "not an admin", and the operator
    // reading the audit line needs to tell them apart. Inert on mainline
    // (`deploymentPayerId()` is null, and `userId` here is never null).
    if (userId === deploymentPayerId()) {
      req.log.warn({ userId }, "admin/sso de-provision REFUSED — target is the deployment's billing account")
      return reply.status(403).send({
        error: {
          code: "payer_account_protected",
          message: "This deployment's billing account cannot be de-provisioned from here.",
        },
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
