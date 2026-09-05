import type { FastifyRequest, FastifyReply } from "fastify"
import { checkIsAdmin } from "../../lib/admin-check.js"
import { deploymentPayerActive } from "../../lib/deployment-payer.js"
import { SSO_APP_METADATA_KEY } from "../../lib/sso-linking.js"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "./require-admin.js"

/**
 * The money gate for a deployment whose IDENTITY PROVIDER BELONGS TO THE
 * CUSTOMER (the deployment-payer item (9) follow-up).
 *
 * WHY A ROLE IS NOT ENOUGH. `requireAdmin` authorizes on `profiles.role`. On
 * a white-label instance the customer runs the SSO IdP, so the customer mints
 * the identities that role is attached to: they can provision a user at will,
 * and any admin we grant them is an identity they can re-assert forever.
 * Authorization keyed on that column is therefore downstream of the party it
 * is meant to constrain. The routes this guards can mint credits, change what
 * a model costs, or promote an account — on a deployment-payer instance every
 * one of them spends OUR money, so they need a gate the customer cannot reach.
 *
 * WHAT THE CUSTOMER CANNOT REACH. Two things, ANDed:
 *   1. `PLATFORM_OPERATOR_EMAILS` — an environment variable, set by us on the
 *      host (Railway), invisible and unwritable from inside the product. Falls
 *      back to `PLATFORM_OWNER_EMAIL` so a single-owner deployment needs no
 *      new configuration.
 *   2. The account must NOT be federated: `app_metadata.sso` absent. This is
 *      the service-role-only copy that `middleware/auth.ts` already treats as
 *      authoritative — `user_metadata` is writable by a public
 *      `supabase.auth.signUp({ options: { data } })` and so can be forged.
 *      Without this half, the allowlist is a list of EMAILS, and the customer
 *      picks which emails their IdP asserts: they would simply provision
 *      `operator@ours.com` and walk in.
 *
 * INERT ON MAINLINE, BY CONSTRUCTION. With no deployment payer configured
 * there is no customer-run IdP in the trust path and no shared wallet to
 * drain, so this delegates to `requireAdmin` verbatim — Nodaro Cloud,
 * business and self-hosted behavior is unchanged, which is what makes the
 * gate safe to apply to routes those deployments use every day.
 *
 * FAIL CLOSED. On a payer instance every uncertainty refuses: no allowlist
 * configured, an unreadable account, a missing email. "Nobody may mint" is a
 * survivable state; "anyone the customer names may mint" is not.
 */

/** 403 body for a refusal that is about OPERATORSHIP, not adminship — a
 *  distinct code so an operator debugging their own lockout can tell the two
 *  apart in one log line. */
const OPERATOR_REQUIRED = {
  error: {
    code: "operator_required",
    message:
      "This operation is restricted to the platform operator on a deployment-payer instance. " +
      "Administrator access alone is not sufficient.",
  },
} as const

/**
 * The allowlist, read FRESH from process.env rather than from `lib/config.js`
 * — the payg-surface-guard discipline. This module lands in the import graph
 * of every money route, and route suites routinely `vi.mock("lib/config.js")`
 * with partial factories; a `config` binding here turns those suites into
 * opaque 500s. The schema entry in config.ts remains the documented ops
 * surface. Empty `PLATFORM_OPERATOR_EMAILS` falls back to the single
 * `PLATFORM_OWNER_EMAIL`, so the common one-owner deployment configures nothing.
 */
export function platformOperatorEmails(): Set<string> {
  const raw = process.env.PLATFORM_OPERATOR_EMAILS?.trim()
    ? process.env.PLATFORM_OPERATOR_EMAILS
    : (process.env.PLATFORM_OWNER_EMAIL ?? "")
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

export async function requirePlatformOperator(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | void> {
  // Mainline: byte-equivalent to the gate these routes carried before.
  if (!deploymentPayerActive()) {
    await requireAdmin(req, reply)
    return
  }

  const userId = req.userId
  if (!userId) {
    return reply.status(401).send({
      error: { code: "unauthorized", message: "Authentication required" },
    })
  }

  // Adminship first, so a non-admin still gets the ordinary 403 and learns
  // nothing about the operator policy.
  if (!(await checkIsAdmin(userId))) {
    return reply.status(403).send({
      error: { code: "forbidden", message: "Admin access required" },
    })
  }

  const route = req.url.split("?")[0]
  const allowed = platformOperatorEmails()
  if (allowed.size === 0) {
    console.error(
      `[platform-operator] ${route}: REFUSED — a deployment payer is active but neither ` +
        "PLATFORM_OPERATOR_EMAILS nor PLATFORM_OWNER_EMAIL is set. Money routes are closed to everyone " +
        "until an operator is configured on the host.",
    )
    return reply.status(403).send(OPERATOR_REQUIRED)
  }

  // One service-role call gives both facts. Deliberately uncached: these
  // routes are rare and administrative, and a stale cache on a money gate
  // buys nothing worth the risk.
  const { data, error } = await supabase.auth.admin.getUserById(userId)
  if (error || !data?.user) {
    console.error(
      `[platform-operator] ${route}: REFUSED — could not read the caller's account (${
        error?.message ?? "no user"
      }). Failing closed.`,
    )
    return reply.status(403).send(OPERATOR_REQUIRED)
  }

  const email = data.user.email?.trim().toLowerCase()
  const federated = Boolean((data.user.app_metadata as Record<string, unknown> | undefined)?.[SSO_APP_METADATA_KEY])

  if (!email || !allowed.has(email) || federated) {
    // Loud by design: on a payer instance this line IS the audit trail for an
    // attempt to reach the money surface. Names the reason, never the allowlist.
    console.warn(
      `[platform-operator] ${route}: REFUSED for admin ${userId} — ${
        federated ? "account is SSO-federated (the customer's IdP controls it)" : "email not in the operator allowlist"
      }`,
    )
    return reply.status(403).send(OPERATOR_REQUIRED)
  }
}
