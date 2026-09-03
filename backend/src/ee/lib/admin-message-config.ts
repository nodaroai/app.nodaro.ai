import { supabase } from "../../lib/supabase.js"

/**
 * The one admin-tunable knob for admin → user email: how many messages a single
 * admin may send per day. Stored as `admin_messages_daily_limit` in
 * `app_settings` (seeded at 50 by migration 375), read here with a 60s cache —
 * same shape as `notify-config.ts`.
 *
 * WHY THIS IS A MODULE AND NOT TWO LINES IN THE ROUTE. Two reasons, both real:
 *
 *  - `money-route-totality.test.ts` classifies any mutating admin route whose
 *    body contains `from("app_settings")` as a money route, because that is how
 *    the markup and margin settings are written. The send route is not a money
 *    route; reading the limit through here keeps that classification true
 *    instead of forcing an entry in the guard's EXCLUDED list.
 *  - A misconfigured row must not open the gate. A missing key, a string where
 *    a number belongs, a negative — every one of them falls back to the
 *    compiled default rather than being read as "no limit".
 */

export const ADMIN_MESSAGES_DAILY_LIMIT_KEY = "admin_messages_daily_limit"

/** Spec default. Also the value migration 375 seeds. */
export const ADMIN_MESSAGES_DAILY_LIMIT_DEFAULT = 50

/** Bounds for an operator-supplied value. Zero is allowed and means "nobody may
 *  send" — a deliberate, reachable off switch, not an accident. */
export const ADMIN_MESSAGES_DAILY_LIMIT_MIN = 0
export const ADMIN_MESSAGES_DAILY_LIMIT_MAX = 1000

const CACHE_TTL_MS = 60_000
let cached: number | null = null
let cachedAt = 0
let inflight: Promise<number> | null = null

export async function getAdminMessagesDailyLimit(): Promise<number> {
  const now = Date.now()
  if (cached !== null && now - cachedAt < CACHE_TTL_MS) return cached
  if (inflight) return inflight
  inflight = refresh()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}

async function refresh(): Promise<number> {
  let limit = ADMIN_MESSAGES_DAILY_LIMIT_DEFAULT
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", ADMIN_MESSAGES_DAILY_LIMIT_KEY)
    .maybeSingle()

  // A read error (table missing on a database that has not taken migration 375
  // yet — staging serves this code for days before that) keeps the default.
  if (!error) {
    const v = (data as { value?: unknown } | null)?.value
    if (
      typeof v === "number" &&
      Number.isInteger(v) &&
      v >= ADMIN_MESSAGES_DAILY_LIMIT_MIN &&
      v <= ADMIN_MESSAGES_DAILY_LIMIT_MAX
    ) {
      limit = v
    }
  }

  cached = limit
  cachedAt = Date.now()
  return limit
}

export function invalidateAdminMessageConfigCache(): void {
  cached = null
  cachedAt = 0
}

/**
 * The window the limit counts over: the current UTC calendar day.
 *
 * UTC and not the operator's timezone, on purpose — the count has to mean the
 * same thing to the route, to a future audit query, and to whoever reads
 * `sent_at` (which is UTC) while wondering why a send was refused. A local-time
 * window would make those three disagree twice a year.
 */
export function dailyWindowStart(now: Date = new Date()): string {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  )
  return start.toISOString()
}
