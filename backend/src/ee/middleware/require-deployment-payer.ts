import type { FastifyRequest, FastifyReply } from "fastify"
import { deploymentPayerId } from "../../lib/deployment-payer.js"

/**
 * THE THIRD GUARD — the billing account's own routes (spec §8.1).
 *
 * The product already has two authorization gates and neither can hold these
 * routes:
 *
 *   - `requireAdmin` authorizes on `profiles.role`. On a deployment-payer
 *     instance the CUSTOMER runs the identity provider, so the customer mints
 *     the identities that column hangs off. Authorization keyed on it is
 *     downstream of the party it would have to constrain.
 *   - `requirePlatformOperator` authorizes NODARO's operator, out of an env
 *     allowlist. That is the right gate for "may this person mint credits on
 *     our platform" and the wrong one here: these routes belong to the
 *     CUSTOMER's billing account — the account that holds the credits, buys
 *     more with its own card, and decides who gets an allowance. The operator
 *     is a different principal, and giving them this surface would make Nodaro
 *     staff the ones administering a customer's allocations.
 *
 * So this guard checks IDENTITY, not authority: `req.userId ===
 * deploymentPayerId()`. That uuid is resolved at boot from
 * `billing.payerAccount` — operator-owned surface-profile configuration,
 * redacted from `/config.js` (`surface-profile-runtime-config.ts`), and null on
 * mainline. Nothing inside the product writes it, so the set of accounts that
 * pass here cannot be widened by any route, role or IdP assertion.
 *
 * WHY THE `authKind` CHECK IS NOT REDUNDANT. Decision (6) puts a payer-owned
 * credential on customer developers' laptops, and `middleware/auth.ts:409-421`
 * resolves an `ndr_<hex>` personal API token to `req.userId = <owner>`. An
 * identity-only guard would therefore let a leaked relay key mint allowances
 * and buy credits on Nodaro's Stripe. Requiring a first-party browser session
 * (`authKind === "jwt"`) closes that, and every write verb ALSO calls
 * `rejectProgrammaticAuth` — deliberately redundant, because the two are
 * enforced in different files and either one going missing must not open the
 * money surface. There is NO `requireAdmin` fallback here, on purpose: a
 * fallback would re-admit exactly the principal the guard excludes.
 *
 * INERT ON MAINLINE (R2). The routes are registered only under `hasCredits()
 * && deploymentPayerActive()`, so with no payer the paths do not exist and this
 * guard never runs. The `payerId` null branch below is consequently dead code
 * in production — kept, and asserted by the test, because a guard that can be
 * mounted anywhere must be safe anywhere: a future route that forgets the
 * registration condition should 404, never open.
 */

/** 403 for a refusal that is about being THE BILLING ACCOUNT — a distinct code
 *  from `operator_required` and `forbidden` so a support ticket that quotes it
 *  identifies the gate in one line. */
const PAYER_REQUIRED = {
  error: {
    code: "payer_required",
    message:
      "This operation is restricted to the deployment's billing account, from a signed-in browser session. " +
      "Administrator access is not sufficient.",
  },
} as const

const UNAUTHORIZED = {
  error: { code: "unauthorized", message: "Authentication required" },
} as const

/** The dead branch's body: a route that exists only under a payer must look
 *  ABSENT, not forbidden, where there is no payer — a 403 would advertise the
 *  feature to an instance that does not have it. */
const NOT_FOUND = {
  error: { code: "not_found", message: "Not found" },
} as const

/** The message `rejectProgrammaticAuth` sends on the write verbs — mirrors
 *  `BILLING_JWT_ONLY_MSG` in `ee/routes/billing.ts:49`. */
export const PAYER_JWT_ONLY_MSG =
  "The billing account's operations are only available from a logged-in session."

export async function requireDeploymentPayer(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const payerId = deploymentPayerId()
  if (!payerId) {
    reply.status(404).send(NOT_FOUND)
    return
  }
  if (!req.userId) {
    reply.status(401).send(UNAUTHORIZED)
    return
  }
  if (req.authKind !== "jwt") {
    // A personal API token or a developer-app OAuth token, even one belonging
    // to the payer itself. Loud, because on a payer instance this line is the
    // audit trail for a credential reaching the money surface.
    console.warn(
      `[deployment-payer-guard] ${req.url}: REFUSED — ${req.authKind ?? "unknown"} credential, not a browser session`,
    )
    reply.status(403).send(PAYER_REQUIRED)
    return
  }
  if (req.userId !== payerId) {
    console.warn(`[deployment-payer-guard] ${req.url}: REFUSED for ${req.userId} — not the billing account`)
    reply.status(403).send(PAYER_REQUIRED)
    return
  }
}
