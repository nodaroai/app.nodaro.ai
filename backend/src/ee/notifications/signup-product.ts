import { supabase } from "../../lib/supabase.js"

/**
 * "Which product did this user sign up through", derived the same way the rest
 * of the app attributes activity: the `app_slug` on the user's EARLIEST
 * non-default project (the client-app-origin system, migration 271). One source
 * of truth — reused by every notification stream.
 *
 * Caveat: at the instant of signup a user usually has no project yet, so this
 * returns "unknown". The daily digest (next morning) has usually resolved it;
 * the immediate every-signup alert often says "unknown". That is expected — the
 * only earlier signal (first_touch_channel) is ~96% empty, so worse.
 */

/** Map a raw `app_slug` (or absence) to a human label. */
function label(appSlug: string | null | undefined, hasProject: boolean): string {
  if (!hasProject) return "unknown"
  if (!appSlug) return "app" // native app.nodaro.ai (default/native projects carry no slug)
  return appSlug
}

export async function signupProduct(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("projects")
    .select("app_slug")
    .eq("user_id", userId)
    .not("is_default", "is", true) // `IS NOT TRUE` — keeps non-default projects (false) and legacy null rows
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) return "unknown"
  const row = data as { app_slug?: string | null } | null
  return label(row?.app_slug, row != null)
}

/** Batch form for the digest: one query for a set of users, earliest non-default
 *  project per user reduced in JS. Returns a Map keyed by user_id. */
export async function signupProductsFor(userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (userIds.length === 0) return out
  const { data, error } = await supabase
    .from("projects")
    .select("user_id, app_slug, created_at")
    .in("user_id", userIds)
    .not("is_default", "is", true)
    .order("created_at", { ascending: true })
  if (error || !data) {
    for (const id of userIds) out.set(id, "unknown")
    return out
  }
  // Rows are created_at-ascending; the FIRST row seen per user is the earliest.
  for (const r of data as Array<{ user_id: string; app_slug: string | null }>) {
    if (!out.has(r.user_id)) out.set(r.user_id, label(r.app_slug, true))
  }
  for (const id of userIds) if (!out.has(id)) out.set(id, "unknown")
  return out
}
