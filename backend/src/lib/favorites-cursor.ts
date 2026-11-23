/**
 * The keyset of `GET /v1/favorites`: one order over five tables.
 *
 * The combined list is ordered by when each favorite was made, newest first;
 * two made in the same microsecond are ordered by kind (`FAVORITE_KINDS`
 * order), then by the row's id, descending. That order is TOTAL, so a cursor
 * — the last item's `(created_at, kind, id)` — names one exact place in it,
 * and each table is asked only for the rows after that place
 * (`keysetFilter`). Nothing is skipped or repeated at a page boundary, ties
 * across kinds included.
 *
 * The timestamp rides in the cursor VERBATIM, as the database wrote it: a
 * round trip through `Date` would drop its microseconds and land the cursor
 * between rows that share a millisecond.
 */
import { z } from "zod"

/** Every kind of favorite, in the order ties between kinds are broken. */
export const FAVORITE_KINDS = ["job", "asset", "voice", "preset", "catalog"] as const
export type FavoriteKind = (typeof FAVORITE_KINDS)[number]

export interface FavoritesCursor {
  /** The last item's `created_at`, as the database wrote it. */
  readonly createdAt: string
  readonly kind: FavoriteKind
  /** The last item's favorite row id. */
  readonly rowId: string
}

const cursorSchema = z.tuple([z.string().min(1).max(64), z.enum(FAVORITE_KINDS), z.string().uuid()])

/** A timestamp as Postgres writes a timestamptz (PostgREST's JSON form). */
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/

export function encodeFavoritesCursor(cursor: FavoritesCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.kind, cursor.rowId]), "utf8").toString("base64url")
}

/** The cursor, or null when the text is not one this API wrote. */
export function decodeFavoritesCursor(text: string): FavoritesCursor | null {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(text, "base64url").toString("utf8")))
    if (!parsed.success || !TIMESTAMP_RE.test(parsed.data[0])) return null
    const [createdAt, kind, rowId] = parsed.data
    return { createdAt, kind, rowId }
  } catch {
    return null
  }
}

/**
 * Microseconds since the epoch, exactly, for ordering. Postgres trims trailing
 * zeros from the fraction, and a `Date` keeps only milliseconds, so the
 * fraction is read as digits.
 */
export function timestampMicros(ts: string): bigint {
  const match = /^(.*?:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(ts)
  if (!match) return BigInt(Date.parse(ts)) * 1000n
  const [, whole, fraction = "", zone] = match
  const seconds = BigInt(Date.parse(`${whole}${zone === "Z" ? "Z" : zone}`))
  return seconds * 1000n + BigInt(fraction.padEnd(6, "0"))
}

/** A row in the combined order. */
export interface OrderedFavorite {
  readonly createdAt: string
  readonly kind: FavoriteKind
  readonly rowId: string
}

const rank = (kind: FavoriteKind): number => FAVORITE_KINDS.indexOf(kind)

/** Negative when `a` comes first: newest first, then kind order, then id descending. */
export function compareFavorites(a: OrderedFavorite, b: OrderedFavorite): number {
  const ta = timestampMicros(a.createdAt)
  const tb = timestampMicros(b.createdAt)
  if (ta !== tb) return ta > tb ? -1 : 1
  if (a.kind !== b.kind) return rank(a.kind) - rank(b.kind)
  return a.rowId === b.rowId ? 0 : a.rowId > b.rowId ? -1 : 1
}

/**
 * The PostgREST `or()` filter that keeps one table's rows strictly AFTER the
 * cursor: a kind before the cursor's has already given its rows at that
 * instant (`<`), the cursor's own kind continues below its id, and a kind
 * after it has given none at that instant yet (`<=`). Both values are trusted:
 * the cursor was validated (`decodeFavoritesCursor`).
 */
export function keysetFilter(kind: FavoriteKind, cursor: FavoritesCursor): string {
  const t = cursor.createdAt
  if (rank(kind) < rank(cursor.kind)) return `created_at.lt.${t}`
  if (rank(kind) > rank(cursor.kind)) return `created_at.lte.${t}`
  return `created_at.lt.${t},and(created_at.eq.${t},id.lt.${cursor.rowId})`
}
