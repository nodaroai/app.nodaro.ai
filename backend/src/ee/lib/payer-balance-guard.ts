import type { FastifyReply, FastifyRequest } from "fastify"
import { deploymentPayerActive, deploymentPayerId } from "../../lib/deployment-payer.js"

/**
 * The deployment payer's real credit pool is the OPERATOR's number, and it is
 * readable only from that account's own browser session.
 *
 * Spec 2026-09-04-sai-local-development invariant 7 / D10: "a relayed request
 * never learns the payer's real credit balance". The relay credential is an
 * `ndr_app_` token OWNED BY THE PAYER, so `middleware/auth.ts` sets
 * `req.userId = <the payer>` and `req.authKind = "app_token"` — every
 * balance-shaped route then answers the operator's wallet to whatever holds
 * that credential (which, by design, includes the self-host it was issued to).
 * Closing one door left the siblings open: `GET /v1/user/credits` and
 * `GET /v1/credits/check` answer the same figure as `GET /v1/credits/balance`.
 *
 * IDENTITY-SCOPED, not credential-scoped, and the distinction is the whole
 * design. `rejectProgrammaticAuth` here would 403 every ordinary API/SDK
 * consumer's balance read on every instance, payer or not — a breaking change
 * to a documented public route (docs/api-integration.md §12). This refuses
 * exactly one identity on exactly one kind of deployment.
 *
 * CALL IT BEFORE ANY BALANCE READ, including a cache read: the balance cache in
 * ee/routes/credits.ts is keyed by userId alone, so the payer's own browser
 * session warms an entry a later app_token request would otherwise be handed.
 *
 * INERT with no payer configured: `deploymentPayerActive()` is false and the
 * whole condition short-circuits, so every non-payer deployment is unchanged.
 *
 * @returns true when it has already sent the 403 and the handler must return.
 */
export function refusePayerBalanceToProgrammaticCaller(
  req: FastifyRequest,
  reply: FastifyReply,
): boolean {
  if (!deploymentPayerActive()) return false
  if (!req.userId || req.userId !== deploymentPayerId()) return false
  if (req.authKind === "jwt") return false
  reply.status(403).send({
    error: {
      code: "payer_balance_jwt_only",
      message: "The deployment balance is available to the billing account's own session only.",
    },
  })
  return true
}
