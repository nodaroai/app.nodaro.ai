import { supabase } from "./supabase.js"

/**
 * Usage ratio at which a user is considered to have hit the storage wall.
 *
 * MUST match the client meter's amber threshold — `STORAGE_WARN_RATIO` in
 * vcp.nodaro.ai/src/hooks/useStorageStatus.ts:26. The GTM funnel joins the two,
 * so a divergence would silently mean "the meter turned amber" and "the user
 * crossed the threshold" describe different populations, and the monetization
 * numbers would be comparing unlike things.
 */
export const STORAGE_WARN_RATIO = 0.85

/**
 * Stamp `profiles.storage_warn_crossed_at` the FIRST time a user is observed at
 * or above {@link STORAGE_WARN_RATIO} of their limit.
 *
 * WHY HERE AND NOT IN THE CREDIT GUARD: the guard reads the profile BEFORE a job
 * runs, so it only ever sees usage as of the *previous* request. A user at 80%
 * whose export pushes them to 88%, who then sees the amber meter, upgrades, and
 * stops generating, would never be stamped — and that is precisely the
 * population the monetization thesis is about. Stamping from
 * `GET /v1/storage/status` — the exact read the meter polls — makes "the meter
 * turned amber" and "the user crossed" the same population by construction, and
 * keeps a write off the generation hot path entirely.
 *
 * Deliberately best-effort: callers do NOT await this and every failure is
 * swallowed. Attribution telemetry must never be able to fail or delay a real
 * request.
 *
 * Cost: users below the threshold (the overwhelming majority) do no database
 * work at all. Above it, the `.is(null)` guard makes the write happen exactly
 * once; subsequent polls match zero rows.
 */
export async function recordStorageWarnCrossing(
  userId: string,
  usedBytes: number,
  limitBytes: number | null,
): Promise<void> {
  // No enforced cap (self-hosted, unlimited tiers) → no threshold to cross.
  if (!limitBytes || limitBytes <= 0) return
  if (usedBytes / limitBytes < STORAGE_WARN_RATIO) return

  try {
    const { error } = await supabase
      .from("profiles")
      .update({ storage_warn_crossed_at: new Date().toISOString() })
      .eq("id", userId)
      .is("storage_warn_crossed_at", null)
    if (error) console.warn("[storage-warn] stamp failed:", error.message)
  } catch (err) {
    console.warn("[storage-warn] stamp threw:", err)
  }
}
