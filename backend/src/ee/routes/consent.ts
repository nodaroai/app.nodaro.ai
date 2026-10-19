import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { rejectProgrammaticAuth } from "../../lib/api-auth-mode.js"
import { getConsentConfig } from "../lib/consent-config.js"
import { syncConsentRow } from "../lib/consent-loops-sync.js"
import { consentLocaleField } from "../lib/consent-locale.js"
import { CONSENT_KIND, recordConsentGrant, recordConsentOptOut } from "../lib/consent-record.js"
import { getWelcomeOfferConfig } from "../lib/welcome-offer-config.js"
import { readFreeGrantState, readWelcomeOfferState } from "../billing/signup-grant.js"

/**
 * Marketing-email consent — Cloud-only (registered under hasCredits()). The
 * browser polls `GET /v1/consent/state` on load; the popup renders only when it
 * answers `shouldShow: true`, and posts back grant / decline / withdraw.
 *
 * FIRST-PARTY BROWSER ONLY. Consent is a legal record about a human choosing in
 * a browser; a programmatic (API-token / OAuth) caller can never legitimately
 * supply it, and one-shot writes must not be burnable by a third party — so
 * every route rejects non-JWT callers (same gate as profile-attribution).
 */

const JWT_ONLY_MSG = "Consent can only be recorded from a first-party browser session"

/**
 * While the welcome offer is on, two kinds of account are asked by the welcome
 * popup / banner and never by this prompt: one that has not claimed its
 * credits, and one granted through the extension that still owes its consent.
 */
async function welcomeOfferOwnsTheAsk(userId: string): Promise<boolean> {
  try {
    const cfg = await getWelcomeOfferConfig()
    if (!cfg.enabled) return false
    if ((await readFreeGrantState(userId)) === "unclaimed") return true
    return (await readWelcomeOfferState(userId))?.consentPending === true
  } catch {
    return false
  }
}

// Same slug grammar attribution uses; the client normalizes to it. `locale` is
// the interface language the answer was given in — lenient by contract, so an
// older client (which sends none) and an unknown id are both read as "not said".
const answerBody = z.object({
  sourceApp: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).optional(),
  locale: consentLocaleField,
})

// An opt-out carries only the language; a body that is not an object, or names
// none we ship, records no language and the opt-out still goes through.
const optOutBody = z.object({ locale: consentLocaleField })

function requireBrowserUser(req: FastifyRequest, reply: FastifyReply): string | null {
  const userId = req.userId
  if (!userId) {
    reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    return null
  }
  if (rejectProgrammaticAuth(req, reply, JWT_ONLY_MSG)) return null
  return userId
}

export async function consentRoutes(app: FastifyInstance): Promise<void> {
  // Whether to show the prompt now — the atomic decide-and-stamp lives in the
  // consent_try_show RPC so the four apps sharing a session can't double-count.
  app.get(
    "/v1/consent/state",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const userId = requireBrowserUser(req, reply)
      if (!userId) return

      const cfg = await getConsentConfig()
      if (!cfg.enabled) return { shouldShow: false, status: "disabled" }

      // While the welcome offer is on, an account that has not claimed its
      // credits is asked by the welcome popup / banner — never twice on one
      // screen, and this read must not burn one of its cadence-limited asks.
      if (await welcomeOfferOwnsTheAsk(userId)) return { shouldShow: false, status: "welcome_offer" }

      try {
        const { data, error } = await supabase.rpc("consent_try_show", {
          p_user_id: userId,
          p_kind: CONSENT_KIND,
          p_pending_cadence_seconds: Math.round(cfg.cadenceHours * 3600),
          p_withdrawn_cadence_seconds: Math.round(cfg.withdrawnCadenceHours * 3600),
          p_max: cfg.maxAsks,
        })
        if (error) {
          // Table/RPC not present yet (staging runs ahead of migration 372) or a
          // transient DB error — stay dormant, never 500 the read the client polls.
          req.log.warn({ err: error.message }, "consent_try_show unavailable")
          return { shouldShow: false, status: "unavailable" }
        }
        const row = Array.isArray(data) ? (data[0] as { did_show?: boolean; status?: string } | undefined) : undefined
        const shouldShow = Boolean(row?.did_show)
        return shouldShow
          ? { shouldShow: true, status: row?.status ?? "pending", text: cfg.text, version: cfg.version }
          : { shouldShow: false, status: row?.status ?? "pending" }
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to read consent state")
      }
    },
  )

  // Read-only status — for the Settings opt-out toggle. Deliberately does NOT
  // stamp a show (unlike /state), so merely opening Settings never burns an ask.
  app.get(
    "/v1/consent/status",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const userId = requireBrowserUser(req, reply)
      if (!userId) return
      const { data, error } = await supabase
        .from("user_consents")
        .select("status")
        .eq("user_id", userId)
        .eq("kind", CONSENT_KIND)
        .maybeSingle()
      // Missing table (staging pre-migration) or any read error → 'unknown',
      // never a 500 on a Settings read.
      if (error) return { status: "unknown", subscribed: false }
      const status = (data as { status?: string } | null)?.status ?? "pending"
      return { status, subscribed: status === "granted" }
    },
  )

  // Approve — subscribes the user and marks the row for a Loops push.
  app.post(
    "/v1/consent/grant",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const userId = requireBrowserUser(req, reply)
      if (!userId) return

      const parsed = answerBody.safeParse(req.body ?? {})
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid body" },
        })
      }

      // One helper for every grant path (this route, the welcome-offer claim):
      // the row goes to 'granted' and the extension's consent-pending mark is
      // cleared, so a "yes" from Settings unblocks creation like any other.
      const { error } = await recordConsentGrant(userId, parsed.data.sourceApp ?? null, parsed.data.locale ?? null, req.log)
      if (error) return sendInternalError(reply, req, new Error(error), "Failed to record consent")

      void syncConsentRow(userId).catch(() => {})
      return { status: "granted" }
    },
  )

  // "No thanks" — terminal, never asked again.
  app.post(
    "/v1/consent/decline",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    (req, reply) => recordOptOut(req, reply, "declined"),
  )

  // Opt out from Settings after having granted — re-askable on the gentle cadence.
  app.post(
    "/v1/consent/withdraw",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    (req, reply) => recordOptOut(req, reply, "withdrawn"),
  )
}

async function recordOptOut(
  req: FastifyRequest,
  reply: FastifyReply,
  status: "declined" | "withdrawn",
): Promise<unknown> {
  const userId = requireBrowserUser(req, reply)
  if (!userId) return

  const locale = optOutBody.safeParse(req.body ?? {}).data?.locale ?? null
  const { error } = await recordConsentOptOut(userId, status, locale, req.log)
  if (error) return sendInternalError(reply, req, new Error(error), "Failed to record consent")

  void syncConsentRow(userId).catch(() => {})
  return { status }
}
