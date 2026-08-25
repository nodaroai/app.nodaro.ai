/**
 * Keyset-pagination cursor over `(created_at, id)` — the shape any core list
 * route needs when it pages an `ORDER BY created_at DESC, id DESC` listing.
 *
 * WHY A COMPOSITE, NOT A BARE TIMESTAMP: `created_at` is
 * `TIMESTAMPTZ NOT NULL DEFAULT NOW()`, and `NOW()` is the TRANSACTION
 * timestamp — every row inserted in one transaction (a bulk import, a seed, a
 * multi-row RPC) shares an identical value. A bare `created_at.lt.<ts>` cursor
 * skips EVERY row tied with the last row of the page, silently dropping them
 * from the result set. Pairing the timestamp with the row id gives a TOTAL
 * order, so the page boundary lands between two specific rows and nothing can
 * fall through it.
 *
 * WHY THE FIELDS ARE STRICTLY VALIDATED: the decoded fields are interpolated
 * directly into PostgREST `.or(...)` filter strings
 * (`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`),
 * so an attacker-controlled cursor is a filter-injection vector — a value
 * carrying a comma or paren would inject extra filter conditions. Every field
 * is therefore format-checked after base64-decoding and the whole cursor is
 * rejected (null) on any mismatch. The server only ever emits cursors with both
 * fields present, so requiring both is correct.
 *
 * The cursor is OPAQUE to clients: encode/decode is a server-side detail and
 * callers only ever echo `nextCursor` back as `cursor`. That is what lets the
 * internal scheme change later without a breaking API change.
 *
 * RELATED: `ee/routes/community-cursor.ts` is a three-field variant
 * (`clone_count, created_at, id`) for the community feed's `popular` sort. It
 * is deliberately NOT shared with this module — core may not import from `ee/`
 * (enforced by `tools/check-ee-imports.mjs`), and its extra field is coupled to
 * a sort mode this one does not have.
 */

export interface KeysetCursor {
  createdAt: string
  id: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ISO-8601 timestamp as Supabase/PostgREST returns it. Deliberately excludes
// the PostgREST filter metacharacters `,` `(` `)` — only digits, `-`, `:`, `.`,
// `T`, `+`, `Z` are permitted, so a validated value cannot break out of the
// `created_at.lt.<value>` clause.
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:?\d{2}|Z)?$/

/**
 * Decode + strict-validate a base64 keyset cursor. Returns null for absent,
 * malformed, or any field failing its format check (never throws).
 *
 * A null return for a cursor the caller DID supply means "invalid" — routes
 * should surface that as a 400 rather than silently serving page 1, which a
 * rolling-load client would append forever as duplicates.
 */
export function decodeKeysetCursor(raw: string | undefined | null): KeysetCursor | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"))
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const { createdAt, id } = parsed as Record<string, unknown>
  if (typeof createdAt !== "string" || !ISO_TS_RE.test(createdAt)) return null
  if (typeof id !== "string" || !UUID_RE.test(id)) return null
  return { createdAt, id }
}

/** Encode the keyset cursor for the next page (always both fields). */
export function encodeKeysetCursor(c: KeysetCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64")
}

/**
 * The PostgREST `.or(...)` predicate for "strictly after this cursor" under
 * `ORDER BY created_at DESC, id DESC`. Pass the result to `query.or(...)`.
 *
 * Only ever call this with a cursor returned by `decodeKeysetCursor` — the
 * interpolation below is safe precisely because those fields are format-checked.
 */
export function keysetFilter(c: KeysetCursor): string {
  return `created_at.lt.${c.createdAt},and(created_at.eq.${c.createdAt},id.lt.${c.id})`
}

/**
 * The probe-slice-encode step every keyset-paginated list shares.
 *
 * The route over-fetches by ONE row (`.limit(limit + 1)`): the extra row is
 * how it learns another page exists without a second round-trip. This helper
 * is the other half — slice the probe off so a page never exceeds the
 * caller's limit, and mint the cursor from the last row that stays. Keeping
 * it in one place is what stops a fifth list route from hand-rolling the
 * slice and getting the boundary row wrong.
 */
export function sliceKeysetPage<T extends { created_at: string; id: string }>(
  rows: T[],
  limit: number,
): { page: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page[page.length - 1]
  return {
    page,
    nextCursor: hasMore && last ? encodeKeysetCursor({ createdAt: last.created_at, id: last.id }) : null,
  }
}
