import type { FastifyBaseLogger } from "fastify"
import type { LocaleId } from "@nodaro/shared/i18n"
import { supabase } from "../../lib/supabase.js"
import { isMissingColumnError } from "../../lib/postgrest-errors.js"
import { getConsentConfig } from "./consent-config.js"

/** The one consent kind the platform records today. */
export const CONSENT_KIND = "marketing_email"

type ConsentRowWrite = { user_id: string; locale?: LocaleId | null } & Record<string, unknown>

/**
 * Upsert one `user_consents` row.
 *
 * `locale` — the interface language the consent was answered in — arrives with
 * its migration, and a migration reaches the shared database only when `main`
 * deploys, so staging writes it for days before the column exists. A write that
 * names it and is answered "no such column" is written again without it: the
 * consent itself must never fail over its own annotation.
 */
async function upsertConsentRow(row: ConsentRowWrite, log: FastifyBaseLogger): Promise<{ error: string | null }> {
  const first = await supabase.from("user_consents").upsert(row, { onConflict: "user_id,kind" })
  if (!first.error) return { error: null }
  if (!("locale" in row) || !isMissingColumnError(first.error)) return { error: first.error.message }

  log.warn({ userId: row.user_id }, "consent: user_consents.locale is not in this database yet; recording without it")
  const { locale: _locale, ...withoutLocale } = row
  const retry = await supabase.from("user_consents").upsert(withoutLocale, { onConflict: "user_id,kind" })
  return { error: retry.error?.message ?? null }
}

/**
 * Record a marketing-email consent GRANT for a user.
 *
 * Shared by `POST /v1/consent/grant` (the settings toggle and the old prompt)
 * and by the welcome-offer claim, so a grant means exactly one thing wherever
 * it is answered: the row goes to `granted` with the copy version, the
 * answering app and the interface language it was given in, and is flagged for
 * the Loops push (the caller runs `syncConsentRow` — it is not awaited here so
 * a slow Loops call never sits in front of a credit grant).
 *
 * `locale` is the language of the LATEST consent: a later grant in another
 * language replaces it, and one from a client that does not say writes null
 * ("not recorded") rather than leaving an earlier consent's language standing
 * as this one's. It is the interface language, not a record of the copy's
 * wording in it: `consent_version` still identifies the admin-configured copy.
 *
 * It also clears `profiles.welcome_consent_pending` — the mark an
 * extension-granted account carries until it consents somewhere. Best-effort:
 * the column arrives with migration 426 and a dev deploy may run ahead of it.
 */
export async function recordConsentGrant(
  userId: string,
  sourceApp: string | null,
  locale: LocaleId | null,
  log: FastifyBaseLogger,
): Promise<{ error: string | null }> {
  const cfg = await getConsentConfig()
  const nowIso = new Date().toISOString()
  const { error } = await upsertConsentRow(
    {
      user_id: userId,
      kind: CONSENT_KIND,
      status: "granted",
      granted_at: nowIso,
      consent_version: cfg.version,
      source_app: sourceApp,
      locale,
      loops_dirty: true,
      // Re-grant (e.g. re-subscribing from Settings) clears the prior
      // opt-out marks so status and the *_at timestamps stay consistent.
      declined_at: null,
      withdrawn_at: null,
      updated_at: nowIso,
    },
    log,
  )
  if (error) return { error }

  await clearWelcomeConsentPending(userId, log)
  // `consentPending` rides the cached balance every app polls — a "yes" from
  // Settings must unblock creation on the next read, not after the TTL.
  await invalidateBalance(userId, log)
  return { error: null }
}

/**
 * Record a DECLINE ("No thanks") or a WITHDRAWAL (the Settings opt-out).
 *
 * The row is always flagged for the Loops push and `syncConsentRow` decides:
 * it no-ops when the user never had a contact (granted_at IS NULL). Deriving
 * "was granted" here with a prior read would lose an unsubscribe to a
 * read-then-write race against a concurrent grant in another tab.
 *
 * The language is written only when the client names one. An opt-out from a
 * client that does not say must not erase the language the grant it ends was
 * given in — which is why, unlike a grant, an absent `locale` leaves the column
 * untouched instead of writing null.
 */
export async function recordConsentOptOut(
  userId: string,
  status: "declined" | "withdrawn",
  locale: LocaleId | null,
  log: FastifyBaseLogger,
): Promise<{ error: string | null }> {
  const nowIso = new Date().toISOString()
  return upsertConsentRow(
    {
      user_id: userId,
      kind: CONSENT_KIND,
      status,
      updated_at: nowIso,
      loops_dirty: true,
      ...(status === "declined" ? { declined_at: nowIso } : { withdrawn_at: nowIso }),
      ...(locale ? { locale } : {}),
    },
    log,
  )
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
