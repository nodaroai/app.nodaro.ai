import type { FastifyBaseLogger } from "fastify"
import { supabase } from "../../lib/supabase.js"
import { getConsentConfig } from "./consent-config.js"

/** The one consent kind the platform records today. */
export const CONSENT_KIND = "marketing_email"

/**
 * Record a marketing-email consent GRANT for a user.
 *
 * Shared by `POST /v1/consent/grant` (the settings toggle and the old prompt)
 * and by the welcome-offer claim, so a grant means exactly one thing wherever
 * it is answered: the row goes to `granted` with the copy version and the
 * answering app, and is flagged for the Loops push (the caller runs
 * `syncConsentRow` — it is not awaited here so a slow Loops call never sits
 * in front of a credit grant).
 *
 * It also clears `profiles.welcome_consent_pending` — the mark an
 * extension-granted account carries until it consents somewhere. Best-effort:
 * the column arrives with migration 426 and a dev deploy may run ahead of it.
 */
export async function recordConsentGrant(
  userId: string,
  sourceApp: string | null,
  log: FastifyBaseLogger,
): Promise<{ error: string | null }> {
  const cfg = await getConsentConfig()
  const nowIso = new Date().toISOString()
  const { error } = await supabase.from("user_consents").upsert(
    {
      user_id: userId,
      kind: CONSENT_KIND,
      status: "granted",
      granted_at: nowIso,
      consent_version: cfg.version,
      source_app: sourceApp,
      loops_dirty: true,
      // Re-grant (e.g. re-subscribing from Settings) clears the prior
      // opt-out marks so status and the *_at timestamps stay consistent.
      declined_at: null,
      withdrawn_at: null,
      updated_at: nowIso,
    },
    { onConflict: "user_id,kind" },
  )
  if (error) return { error: error.message }

  await clearWelcomeConsentPending(userId, log)
  // `consentPending` rides the cached balance every app polls — a "yes" from
  // Settings must unblock creation on the next read, not after the TTL.
  await invalidateBalance(userId, log)
  return { error: null }
}

async function invalidateBalance(userId: string, log: FastifyBaseLogger): Promise<void> {
  try {
    // Lazy: keeps the consent path free of a static billing import.
    const { invalidateBalanceCache } = await import("../billing/balance-cache.js")
    invalidateBalanceCache(userId)
  } catch (err) {
    log.warn({ err, userId }, "welcome offer: balance cache invalidation failed")
  }
}

async function clearWelcomeConsentPending(userId: string, log: FastifyBaseLogger): Promise<void> {
  try {
    const { error } = await supabase
      .from("profiles")
      .update({ welcome_consent_pending: false })
      .eq("id", userId)
      .eq("welcome_consent_pending", true)
    if (error) log.warn({ err: error.message, userId }, "welcome offer: clearing consent-pending failed")
  } catch (err) {
    log.warn({ err, userId }, "welcome offer: clearing consent-pending threw")
  }
}

/** Is this user's marketing-email consent currently granted? Fails closed (false). */
export async function hasGrantedConsent(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("user_consents")
      .select("status")
      .eq("user_id", userId)
      .eq("kind", CONSENT_KIND)
      .maybeSingle()
    if (error || !data) return false
    return (data as { status?: unknown }).status === "granted"
  } catch {
    return false
  }
}
