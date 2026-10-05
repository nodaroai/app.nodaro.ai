import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { rejectProgrammaticAuth } from "../../lib/api-auth-mode.js"
import { callerKeyHash } from "../../routes/oauth-register.js"
import { readFreeGrant, runSignupGrantClaim, type FreeGrantState } from "../billing/signup-grant.js"
import { TIER_CREDITS } from "../billing/stripe-config.js"
import { recordConsentGrant } from "../lib/consent-record.js"
import { syncConsentRow } from "../lib/consent-loops-sync.js"
import { getWelcomeOfferConfig } from "../lib/welcome-offer-config.js"

/**
 * Welcome credits opt-in — the two writes behind the popup and the banner.
 *
 *   POST /v1/credits/welcome-offer/claim  "Yes, email me & add the credits"
 *   POST /v1/credits/welcome-offer/seen   the popup was shown once
 *
 * The claim is ONE atomic user action: record the marketing-email consent
 * (same helper the Settings toggle uses), then run the signup-grant claim
 * with the consent gate on. The abuse gate still decides granted / withheld
 * — consent is necessary, not sufficient — and an account already decided
 * (granted through the extension, or withheld) only has its consent recorded
 * and its consent-pending mark cleared.
 *
 * FIRST-PARTY BROWSER ONLY, like every consent route: a human choosing in a
 * browser is the legal record; an API token can never supply it. Every app
 * (app, studio, voice, recast) calls these with its own `sourceApp`.
 *
 * Cloud-only (registered under hasCredits()), dormant until an admin turns
 * `welcome_offer_enabled` on.
 */

const JWT_ONLY_MSG = "The welcome offer can only be answered from a first-party browser session"

/** A SHA-256 hex digest. Lowercase only: that is what crypto.subtle produces. */
const HEX64 = /^[0-9a-f]{64}$/

// Lenient by contract, per field (same reasoning as claim-signup-grant.ts):
// a fingerprint that is missing or malformed is stored as NULL and never a
// 400. The `sourceApp` slug grammar is the one attribution and consent use.
const fingerprint = z.string().regex(HEX64).optional().catch(undefined)
const claimBody = z.object({
  sourceApp: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).optional().catch(undefined),
  browserKey: fingerprint,
  deviceKey: fingerprint,
})

export interface WelcomeOfferClaimResponse {
  consent: "granted"
  grant: FreeGrantState
  credits: number
}

function requireBrowserUser(req: FastifyRequest, reply: FastifyReply): string | null {
  const userId = req.userId
  if (!userId) {
    reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    return null
  }
  if (rejectProgrammaticAuth(req, reply, JWT_ONLY_MSG)) return null
  return userId
}

async function invalidateBalance(userId: string): Promise<void> {
  // Lazy: `routes/credits.ts` pulls in the whole billing surface.
  const { invalidateBalanceCache } = await import("./credits.js")
  invalidateBalanceCache(userId)
}

export async function welcomeOfferRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/credits/welcome-offer/claim",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const userId = requireBrowserUser(req, reply)
      if (!userId) return

      const cfg = await getWelcomeOfferConfig()
      if (!cfg.enabled) {
        return reply.status(409).send({
          error: { code: "welcome_offer_disabled", message: "The welcome offer is not available right now" },
        })
      }

      // Lenient by contract: a body that is not even an object claims with
      // no fingerprints rather than failing the user's "yes".
      const parsed = claimBody.safeParse(req.body ?? {})
      const body = parsed.success ? parsed.data : {}

      try {
        const consent = await recordConsentGrant(userId, body.sourceApp ?? null, req.log)
        if (consent.error) {
          return sendInternalError(reply, req, new Error(consent.error), "Failed to record consent")
        }

        const grant = await readFreeGrant(userId)
        let state: FreeGrantState = grant?.state ?? "unclaimed"
        if (state === "unclaimed") {
          const outcome = await runSignupGrantClaim(
            {
              userId,
              browserKey: body.browserKey ?? null,
              deviceKey: body.deviceKey ?? null,
              ipHash: callerKeyHash(req, { unknownScope: userId }),
            },
            req.log,
            { requireConsent: true },
          )
          state = outcome.state
        }

        // The consent-pending mark and the popup state ride the cached
        // balance; the claim invalidates it only when credits moved.
        await invalidateBalance(userId)
        void syncConsentRow(userId).catch(() => {})

        const response: WelcomeOfferClaimResponse = { consent: "granted", grant: state, credits: TIER_CREDITS.free }
        return response
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to claim the welcome credits")
      }
    },
  )

  // The popup was shown — once, ever. Idempotent: the first stamp wins.
  app.post(
    "/v1/credits/welcome-offer/seen",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const userId = requireBrowserUser(req, reply)
      if (!userId) return

      // Same gate as the claim: the column exists only from migration 426, and
      // with the offer off there is no popup to have seen.
      const cfg = await getWelcomeOfferConfig()
      if (!cfg.enabled) {
        return reply.status(409).send({
          error: { code: "welcome_offer_disabled", message: "The welcome offer is not available right now" },
        })
      }

      try {
        const { error } = await supabase
          .from("profiles")
          .update({ welcome_offer_seen_at: new Date().toISOString() })
          .eq("id", userId)
          .is("welcome_offer_seen_at", null)
        if (error) return sendInternalError(reply, req, new Error(error.message), "Failed to record the welcome popup")
        await invalidateBalance(userId)
        return { ok: true }
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to record the welcome popup")
      }
    },
  )
}
