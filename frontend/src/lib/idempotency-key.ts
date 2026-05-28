/**
 * Idempotency-Key helpers.
 *
 * Why this exists: AI generation is stochastic — the same prompt+seed-less
 * request can produce different outputs. So the BACKEND cannot deduplicate
 * by request body — two clicks on Generate with identical settings are a
 * legitimate "give me two variations" intent, not a duplicate. The ONLY
 * way to safely deduplicate is for the CLIENT to opt in by sending a
 * stable identifier per logical click.
 *
 * The contract:
 *   - One UUID per user intent (one click of Generate / Run / etc.).
 *   - That UUID is REUSED across all retries of THAT intent:
 *       * React StrictMode double-renders (dev mode)
 *       * Network retries
 *       * Re-firing the same handler within a tick
 *   - A FRESH UUID is generated for the NEXT user intent (the next click).
 *
 * The backend (`backend/src/middleware/credit-guard.ts`) takes the header
 * as the dedup key. The DB UNIQUE constraint on
 * `(user_id, idempotency_key)` (migration 163) closes the race that any
 * read-then-write dedup leaves open.
 *
 * Without a header sent, the backend does NOT dedup — every request creates
 * a fresh row. That's the correct behavior for AI generation: same body,
 * different intent (e.g., the user clicking Generate again to get a new
 * variation) must produce a new row.
 */

/**
 * Generate a fresh idempotency key. Uses the browser-native `crypto.randomUUID`
 * when available (all modern browsers since 2022); falls back to a SHA-style
 * random hex string otherwise.
 */
export function generateIdempotencyKey(): string {
  // Prefer the standardized API. Available in all browsers ≥ Chrome 92,
  // Firefox 95, Safari 15.4, plus Node ≥ 14.17.
  if (
    typeof crypto !== "undefined" &&
    typeof (crypto as { randomUUID?: () => string }).randomUUID === "function"
  ) {
    return (crypto as { randomUUID: () => string }).randomUUID()
  }
  // Fallback: 32 hex chars from crypto.getRandomValues (also widely available).
  // Not RFC-4122 UUID format but length and entropy are equivalent for our
  // dedup needs; the backend treats it as an opaque string.
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  }
  // Last resort — Math.random is not cryptographically strong but a collision
  // here would only affect ONE user's dedup (it's scoped by user_id at the
  // DB constraint). 16 chars of `Math.random().toString(36)` is sufficient
  // entropy for the dedup window.
  return (
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    Date.now().toString(36)
  )
}

/**
 * Merge an Idempotency-Key into a headers object if a key is supplied.
 * Returns a NEW object (does not mutate the input). Drops the header when
 * `key` is undefined / empty string — falsy keys must NOT be sent (the
 * backend treats below-min-length keys as "no header" anyway, but we want
 * to be explicit at the source).
 */
export function withIdempotencyHeader(
  headers: Record<string, string>,
  key: string | undefined,
): Record<string, string> {
  if (!key) return headers
  return { ...headers, "Idempotency-Key": key }
}

/**
 * Derive a per-iteration key from the click-intent key.
 *
 * Each fan-out iteration (list, repeat-count, provider-fanout) is an
 * INTENTIONALLY distinct generation — same click, but the user expects N
 * separate outputs. Sharing one idempotency key across iterations would
 * collapse them all to one row via the backend's UNIQUE constraint.
 * Appending `:iter:N` keeps each iteration distinct while remaining tied
 * to the same click intent for diagnostic purposes.
 *
 * Returns undefined when `base` is undefined (no click intent set, e.g.
 * auto-execute cascade → no dedup wanted), or returns `base` unchanged
 * when there's no iteration (single execution).
 */
export function iterationIdempotencyKey(
  base: string | undefined,
  iterationIndex: number | undefined,
): string | undefined {
  if (!base) return undefined
  if (iterationIndex === undefined) return base
  return `${base}:iter:${iterationIndex}`
}
