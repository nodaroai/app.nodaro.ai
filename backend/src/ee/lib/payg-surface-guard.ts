import type { FastifyReply, FastifyRequest } from "fastify"
import { resolveEffectiveTier } from "@nodaro/shared/credits"
import { deriveJobSource } from "../../lib/job-source.js"
import { supabase } from "../../lib/supabase.js"

/**
 * Spend-surface enforcement (decision log D1, 2026-08-12).
 *
 * The web studio and every other first-party consumer surface (studio /
 * person / voice / recast / recut / stitch SPAs, the browser extension) are
 * subscription products. Credits held WITHOUT an active subscription — the
 * derived "payg" tier — are a developer product, redeemable through the
 * programmatic surfaces only (API, SDK, CLI, MCP), "like ElevenLabs".
 *
 * This is a product boundary, not a security boundary: a user scripting raw
 * HTTP against us with their own JWT presents no Origin, derives as `api`,
 * and passes — at that point they ARE using the API. What the block targets
 * is the logged-in browser session inside our own products.
 *
 * Buying credits stays open everywhere by construction: the billing routes
 * (create-load-session, auto-recharge settings) never call this guard.
 */

const BLOCKED_SOURCES = new Set(["web", "extension"])

/**
 * Flag + exemptions read from process.env DIRECTLY, not from `lib/config.js`
 * — deliberately, same reasoning as job-source.ts's local firstHeaderValue:
 * this module is pulled into the import graph of ~70 route files (via the
 * credit-guard impl and the run-route preHandlers), and route suites
 * routinely vi.mock `lib/config.js` with partial factories (`hasCredits`
 * only). A `config` binding here turns every such suite into opaque 500s.
 * Strict parse mirrors the schema entries in config.ts, which remain the
 * documented ops surface; both default OFF.
 */
const blockEnabled = (): boolean => {
  const v = process.env.PAYG_WEB_BLOCK_ENABLED
  return v === "true" || v === "1"
}

function exemptUserIds(): Set<string> {
  return new Set(
    (process.env.PAYG_WEB_BLOCK_EXEMPT_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  )
}

/**
 * A browser-session request to a first-party consumer surface. Any developer
 * credential (personal API token, app OAuth token, internal secret) passes
 * regardless of Origin — a token-authed browser app is the developer's own
 * product on our API, not ours.
 */
export function isConsumerSurfaceRequest(req: FastifyRequest): boolean {
  if (req.authKind !== "jwt") return false
  return BLOCKED_SOURCES.has(deriveJobSource(req).source)
}

/**
 * Pool-aware candidate check (D1 v2): true when the flag is on AND this is a
 * browser-session consumer-surface request. Deliberately profile-free — the
 * payg resolution happens downstream (checkCreditsWithProfile /
 * reserveCredits / the RPC all self-gate), so callers thread this flag
 * unconditionally and free users / subscribers are unaffected.
 */
export function isWebFreeModeCandidate(req: FastifyRequest): boolean {
  return blockEnabled() && isConsumerSurfaceRequest(req)
}

/** The founder-approved consumer-surface block message. */
export function sendSubscriptionRequired(reply: FastifyReply): void {
  reply.status(403).send({
    error: {
      code: "subscription_required",
      message:
        "Your credits are available through the API, SDK and MCP. Working in the studio requires a subscription.",
    },
  })
}

interface TierProfileFields {
  tier: string | null
  subscription_tier: string | null
  lifetime_topup_credits: number
}

/**
 * Block a payg account spending from a consumer surface. Returns true when
 * the request was rejected (403 already sent) — callers must stop.
 *
 * `profile` lets creditGuard reuse its already-loaded row; standalone call
 * sites (workflow/app/component/pipeline run creation) omit it and a minimal
 * row is fetched here. Fail-open on a missing row: tier enforcement belongs
 * to the credit path, this guard only scopes WHERE spending happens.
 */
export async function blockPaygOnConsumerSurface(
  req: FastifyRequest,
  reply: FastifyReply,
  profile?: TierProfileFields
): Promise<boolean> {
  if (!blockEnabled()) return false
  if (!req.userId || !isConsumerSurfaceRequest(req)) return false
  if (exemptUserIds().has(req.userId)) return false

  let fields = profile
  if (!fields) {
    const { data } = await supabase
      .from("profiles")
      .select("tier, subscription_tier, lifetime_topup_credits")
      .eq("id", req.userId)
      .single()
    if (!data) return false
    fields = data as TierProfileFields
  }

  if (resolveEffectiveTier(fields) !== "payg") return false
  sendSubscriptionRequired(reply)
  return true
}
