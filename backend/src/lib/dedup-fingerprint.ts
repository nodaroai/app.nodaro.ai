import { createHash } from "node:crypto"
import { supabase } from "./supabase.js"

/** Anti-double-click dedup window. Long enough for a human double-click +
 *  any frontend auto-retry on transient error; short enough that a user
 *  re-clicking the same Generate button a minute later starts a fresh job. */
export const DEDUP_TTL_MS = 10_000

/** Minimum length of a client-supplied Idempotency-Key. Below this we reject
 *  the header and fall back to fingerprint — short keys (empty string, "x")
 *  would collide across unrelated requests from buggy clients. 8 chars is
 *  enough to accommodate truncated UUID prefixes while excluding obvious
 *  garbage.
 *
 *  Lives here (not in middleware/credit-guard.ts) so routes that parse the
 *  header directly — workflow-execution.ts, future routes — can import it
 *  without inverting the natural middleware→routes dependency direction. */
export const MIN_IDEMPOTENCY_KEY_LENGTH = 8

/**
 * SHA-256 over the route key + stable-stringified body. The stable
 * stringifier sorts object keys recursively so two POSTs that JSON-encode
 * differently (e.g., `{a:1,b:2}` vs `{b:2,a:1}`) collide.
 *
 * `routeKey` is typically `req.url` so different endpoints with identical
 * bodies don't collide. Returns the hex digest (64 chars).
 */
export function computeFingerprint(routeKey: string, body: unknown): string {
  return createHash("sha256")
    .update(routeKey)
    .update(":")
    .update(stableStringify(body))
    .digest("hex")
}

/**
 * SELECT the most-recent matching jobs row for this user + key within the
 * dedup window. Returns null if no recent match. The `key` parameter is
 * either a client-supplied Idempotency-Key (preferred) or the SHA-256
 * fingerprint (backstop). `creditGuard` writes both `idempotency_key` and
 * `input_fingerprint` columns on every job INSERT — for fingerprint-only
 * requests the values are identical; with a header they diverge. We query
 * the new authoritative column (`idempotency_key`, migration 163) so the
 * header path works. Race-proof correctness lives in
 * `insertWithIdempotencyKey`, which uses the same column's UNIQUE
 * constraint — this SELECT is just a best-effort fast path that avoids
 * the INSERT roundtrip for obvious double-clicks.
 *
 * Best-effort: any error (DB blip, missing column on pre-migration deploys,
 * etc.) returns null so the request proceeds normally — never breaks a
 * generation because dedup couldn't run.
 */
export async function findRecentMatchingJob(
  userId: string,
  key: string,
): Promise<{ id: string } | null> {
  try {
    const since = new Date(Date.now() - DEDUP_TTL_MS).toISOString()
    const { data } = await supabase
      .from("jobs")
      .select("id")
      .eq("user_id", userId)
      .eq("idempotency_key", key)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    return (data as { id: string } | null) ?? null
  } catch {
    return null
  }
}

/** Stable JSON stringification: object keys sorted recursively so different
 *  serialization orders produce identical output. Mirrors `safe-stable-
 *  stringify` for our purposes without pulling in a dependency. */
function stableStringify(value: unknown): string {
  if (value === undefined) return "null"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]"
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") +
    "}"
  )
}
