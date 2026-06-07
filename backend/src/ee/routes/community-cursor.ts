/**
 * Keyset-pagination cursor for the public community feed.
 *
 * The decoded fields are interpolated directly into PostgREST `.or(...)` filter
 * strings (`clone_count.lt.${count}`, `created_at.lt.${createdAt}`, …), so an
 * attacker-controlled cursor is a filter-injection vector: a value containing a
 * comma or paren would inject extra filter conditions. We therefore STRICTLY
 * validate every field after base64-decoding and reject (return null) on any
 * mismatch. The server only ever emits cursors with all three fields present
 * (see `encodeCommunityCursor`), so requiring all three is correct.
 */

export interface CommunityCursor {
  count: number
  createdAt: string
  id: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// ISO-8601 timestamp as Supabase/PostgREST returns it. Deliberately excludes
// the PostgREST filter metacharacters `,` `(` `)` — only digits, `-`, `:`, `.`,
// `T`, `+`, `Z` are permitted, so a validated value cannot break out of the
// `created_at.lt.<value>` clause.
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:?\d{2}|Z)?$/

/** Decode + strict-validate the base64 cursor. Returns null for absent, malformed,
 *  or any field that fails its type/format check (never throws). */
export function decodeCommunityCursor(raw: string | undefined | null): CommunityCursor | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"))
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const { count, createdAt, id } = parsed as Record<string, unknown>
  if (!Number.isInteger(count) || (count as number) < 0) return null
  if (typeof createdAt !== "string" || !ISO_TS_RE.test(createdAt)) return null
  if (typeof id !== "string" || !UUID_RE.test(id)) return null
  return { count: count as number, createdAt, id }
}

/** Encode the keyset cursor for the next page (always all three fields). */
export function encodeCommunityCursor(c: CommunityCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64")
}
