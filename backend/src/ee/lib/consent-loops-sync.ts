import { supabase } from "../../lib/supabase.js"
import { isMissingColumnError } from "../../lib/postgrest-errors.js"
import {
  updateContact,
  isLoopsConfigured,
  LOOPS_LANGUAGE_PROPERTY,
  type LoopsContactProperties,
  type LoopsResult,
} from "./loops-client.js"
import { languageProperty } from "./loops-contact-properties.js"
import { firstNameFrom } from "./recipient-first-name.js"

const CONSENT_KIND = "marketing_email"

// After this many consecutive failed pushes, give up on a row (clear its dirty
// flag) rather than retrying it every sweep forever.
const MAX_SYNC_ATTEMPTS = 5

interface ConsentRow {
  status: string
  granted_at: string | null
  source_app: string | null
  /** The interface language the consent was given in; null = not recorded. */
  locale?: string | null
  loops_sync_attempts: number | null
}

const ROW_COLUMNS = "status, granted_at, source_app, loops_sync_attempts"

/**
 * One consent row. `locale` arrives with its migration, and a migration reaches
 * the shared database only when `main` deploys, so staging runs ahead of it: a
 * read answered "no such column" asks again without it. The contact then goes
 * out without a language, and the row is read whole once the column exists.
 */
async function readConsentRow(userId: string, kind: string): Promise<ConsentRow | null> {
  const read = (columns: string) =>
    supabase.from("user_consents").select(columns).eq("user_id", userId).eq("kind", kind).maybeSingle()
  let { data, error } = await read(`${ROW_COLUMNS}, locale`)
  if (error && isMissingColumnError(error)) ({ data, error } = await read(ROW_COLUMNS))
  return (data as unknown as ConsentRow | null) ?? null
}

/**
 * Loops answered, and the answer was no to what we sent: a 4xx that is not a
 * rate limit and not about the key itself (401/403 — nothing we change in the
 * request fixes those). As opposed to an outage.
 */
function refusedByLoops(result: LoopsResult): boolean {
  const status = result.status
  return status !== undefined && status >= 400 && status < 500 && status !== 429 && status !== 401 && status !== 403
}

/**
 * Push the contact, with the customer's language when there is one to send.
 *
 * The subscribed state is what this mirror is for, so the language never gets
 * in its way: an update Loops refuses with the language attached is sent again
 * without it. The returned result is the one that decides the row's state, and
 * it is the same one the push would have had before the language existed.
 */
async function pushContact(
  email: string,
  contact: LoopsContactProperties,
  language: string | null,
): Promise<LoopsResult> {
  if (!language) return updateContact(email, contact)

  const withLanguage = await updateContact(email, { ...contact, [LOOPS_LANGUAGE_PROPERTY]: language })
  if (withLanguage.ok || !refusedByLoops(withLanguage)) return withLanguage

  // Most likely the property was removed from the account: say so, and look
  // again at the next sync.
  console.warn(
    `[consent-loops-sync] Loops refused a contact update that carried the language (${withLanguage.status}: ${withLanguage.error ?? "no reason given"}); sending it without`,
  )
  languageProperty.forget()
  return updateContact(email, contact)
}

/**
 * Reconcile ONE consent row into Loops. Best-effort and never throws: on
 * success it clears `loops_dirty` + stamps `loops_synced_at`; on failure it
 * records `loops_sync_status = 'error'` and leaves the row dirty so the sweep
 * retries. A Loops outage must never break the consent write it mirrors.
 *
 * Only users who have EVER granted get a Loops contact — a decline/stop that
 * never granted has nothing to push, so we just clear the flag.
 *
 * The customer's language rides along when it is known and its Loops property
 * exists; a row with none sends no `language` key at all, so it can never
 * overwrite one Loops already has. The language NEVER decides the row's state:
 * a contact Loops accepted is mirrored, with or without it. Holding the row
 * dirty until the language arrives would make the sweep send `subscribed: true`
 * again, hour after hour, which undoes an unsubscribe made from an email.
 */
export async function syncConsentRow(userId: string, kind: string = CONSENT_KIND): Promise<void> {
  if (!isLoopsConfigured()) return // dormant until LOOPS_API_KEY is set

  // First, and before the row is read: cold, this can take up to three Loops
  // calls, and it must not sit between reading a row and pushing it — a
  // withdrawal landing in that gap would be answered by two pushes in no fixed
  // order. Once the property is confirmed it costs nothing.
  const languageReady = await languageProperty.ensure()

  const c = await readConsentRow(userId, kind)
  if (!c) return

  if (!c.granted_at) {
    // Never had a Loops contact — nothing to mirror.
    await clearDirty(userId, kind, "synced")
    return
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("id", userId)
    .maybeSingle()
  const email = ((profile?.email as string | undefined) ?? "").trim()
  if (!email) {
    await clearDirty(userId, kind, "error")
    return
  }
  const firstName = firstNameFrom(profile?.full_name as string | null | undefined)

  const result = await pushContact(
    email,
    {
      firstName,
      subscribed: c.status === "granted",
      userId,
      source: c.source_app ?? undefined,
    },
    languageReady ? (c.locale ?? null) : null,
  )

  const nowIso = new Date().toISOString()
  if (result.ok) {
    await supabase
      .from("user_consents")
      .update({ loops_dirty: false, loops_synced_at: nowIso, loops_sync_status: "synced", loops_sync_attempts: 0, updated_at: nowIso })
      .eq("user_id", userId)
      .eq("kind", kind)
  } else {
    // Cap retries: after MAX_SYNC_ATTEMPTS failures, give up (clear loops_dirty)
    // and leave the row visibly 'error' rather than retrying it forever.
    const attempts = (c.loops_sync_attempts ?? 0) + 1
    const giveUp = attempts >= MAX_SYNC_ATTEMPTS
    await supabase
      .from("user_consents")
      .update({ loops_sync_status: "error", loops_sync_attempts: attempts, loops_dirty: !giveUp, updated_at: nowIso })
      .eq("user_id", userId)
      .eq("kind", kind)
  }
}

async function clearDirty(userId: string, kind: string, status: "synced" | "error"): Promise<void> {
  await supabase
    .from("user_consents")
    .update({ loops_dirty: false, loops_sync_status: status, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("kind", kind)
}

/**
 * Backfill sweep — reconcile every row whose Loops state is stale. Runs on the
 * Cloud-only cleanup cron. Returns how many rows it pushed.
 */
export async function sweepUnsyncedConsents(limit = 200): Promise<number> {
  if (!isLoopsConfigured()) return 0
  const { data, error } = await supabase
    .from("user_consents")
    .select("user_id, kind")
    .eq("loops_dirty", true)
    .limit(limit)
  if (error || !data) return 0

  const rows = data as Array<{ user_id: string; kind: string }>
  // Bounded concurrency so a Loops outage can't turn the hourly sweep into a
  // long serial stall (up to `limit` rows x the per-call timeout).
  const CONCURRENCY = 5
  let synced = 0
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY)
    await Promise.all(
      chunk.map((r) =>
        syncConsentRow(r.user_id, r.kind)
          .then(() => {
            synced++
          })
          .catch(() => {
            // syncConsentRow already swallows its own errors; guard the loop.
          }),
      ),
    )
  }
  return synced
}
