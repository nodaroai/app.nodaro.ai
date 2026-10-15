import type { FastifyReply, FastifyRequest } from "fastify"

/**
 * Reject requests authenticated via a PROGRAMMATIC token — a developer-app OAuth
 * access token (`req.appAuthorization`) or a personal API token (`req.apiToken`).
 *
 * Some routes are first-party-only: the editor (Supabase JWT) may call them, but
 * programmatic clients must not. A first-party JWT request has NEITHER field set
 * by the auth hook, so this guard lets it through and blocks everything else.
 *
 * The first call site, API-token management (`POST/GET/PATCH/DELETE
 * /v1/api-tokens`), is documented "JWT auth required". Without this, an OAuth
 * app holding ANY scope could call `POST /v1/api-tokens` and mint an unscoped
 * personal API token (which carries no `appAuthorization`, so every
 * `requireScope` check becomes a no-op) — a privilege escalation / account
 * takeover beyond the scopes the user granted.
 *
 * Node-preset writes do not use it: the user's personal key and an OAuth app
 * granted `assets:write` may write presets, and the billing key is refused by
 * the presets' own guard (lib/presets/write-access.ts).
 *
 * A third programmatic kind joined the two above: the BILLING INTEGRATION KEY
 * (`req.billingKey`), the machine credential for the deployment's billing
 * surface. It is refused by DEFAULT here, which is the point — this guard is
 * the second, independent defence behind the auth hook's path allow-list, and
 * every existing call site inherits the refusal without being edited. Only the
 * few billing routes that mean to accept the key pass `allowBillingKey: true`,
 * and even then the money verbs (buying credits, minting another key) refuse it
 * locally with their own code, because those two are browser-session verbs
 * forever.
 *
 * Returns true (and sends a 403) when the caller is a programmatic token — the
 * handler must `return` immediately. Returns false for first-party JWT callers.
 */
export function rejectProgrammaticAuth(
  req: FastifyRequest,
  reply: FastifyReply,
  message: string,
  opts?: { allowPersonalToken?: boolean; allowBillingKey?: boolean },
): boolean {
  // OAuth app tokens are ALWAYS rejected (no scope can authorize these first-party
  // routes → privilege-escalation class). Personal API tokens (the user's own
  // full-access key) are rejected too, unless the route is a supported SDK surface
  // (allowPersonalToken — e.g. developer-app management has a @nodaro/sdk
  // resource that uses a personal token). Billing integration keys likewise,
  // unless the route opted in. First-party JWT sets none of the three and passes.
  if (
    req.appAuthorization ||
    (req.apiToken && !opts?.allowPersonalToken) ||
    (req.billingKey && !opts?.allowBillingKey)
  ) {
    reply.status(403).send({ error: { code: "forbidden", message } })
    return true
  }
  return false
}
