import { supabase } from "./supabase.js"

export interface IdempotentInsertResult<T> {
  row: T
  /** True if this call won the race and inserted the row. False if a prior
   *  call had already inserted a row with the same (user_id, idempotency_key)
   *  and this call observed it. Callers use this to decide whether to set the
   *  `X-Dedup-Hit` response header / mark the API response as a deduped echo. */
  created: boolean
}

/** PostgREST's `.single()` answer when no row matched. */
const NO_ROW = "PGRST116"

/**
 * The insert lost its race at the unique key, but the row that won is gone by
 * the time it is read (deleted in between). Nothing was created; the caller
 * answers it as a retryable 503 (`IDEMPOTENCY_WINNER_GONE`, `Retry-After: 2`):
 * the next attempt finds the key free, or a row to answer from.
 */
export class IdempotencyWinnerGoneError extends Error {
  constructor(table: string, userId: string, idempotencyKey: string) {
    super(`idempotency conflict on ${table} for user=${userId} key=${idempotencyKey} but no row found`)
    this.name = "IdempotencyWinnerGoneError"
  }
}

/** The 503 body for {@link IdempotencyWinnerGoneError} — the credit guard's own lost-race answer. */
export const IDEMPOTENCY_WINNER_GONE = {
  code: "dedup_race_winner_unresolvable",
  message: "Duplicate request detected but the canonical job could not be located. Please retry the request.",
} as const

/**
 * Race-proof idempotent INSERT.
 *
 * When `idempotencyKey` is non-null, this issues an INSERT ... ON CONFLICT
 * DO NOTHING via Supabase `upsert({ ignoreDuplicates: true })`. The matching
 * DB UNIQUE constraint (created by migration 163) on
 *   `(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`
 * closes the TOCTOU race that any read-then-write dedup leaves open: two
 * concurrent callers with the same key can both pass a pre-INSERT SELECT,
 * but only one can win the INSERT — the loser sees an empty result from
 * upsert and falls back to SELECTing the winner's row by (user_id, key).
 *
 * When `idempotencyKey` is null/undefined, this is a plain INSERT with no
 * dedup. Caller is responsible for any higher-level dedup logic.
 *
 * The `selectColumns` arg lets callers fetch additional columns from the
 * returned row (e.g. `"id, status"` when they need both); defaults to "id".
 *
 * Throws on unexpected DB errors — the insert's own PostgREST error rides as
 * the thrown error's `cause`, so a caller can read its `code` (a missing
 * column, a constraint). The conflict-then-empty path is NOT an error — it's
 * the documented success outcome of `ignoreDuplicates: true`.
 */
export async function insertWithIdempotencyKey<T>(
  table: string,
  data: Record<string, unknown> & { user_id: string },
  idempotencyKey: string | null | undefined,
  selectColumns: string = "id",
): Promise<IdempotentInsertResult<T>> {
  if (!idempotencyKey) {
    const { data: row, error } = await supabase
      .from(table)
      .insert(data)
      .select(selectColumns)
      .single()
    if (error) throw new Error(`idempotent insert failed (${table}): ${error.message}`, { cause: error })
    return { row: row as unknown as T, created: true }
  }

  const payload = { ...data, idempotency_key: idempotencyKey }
  const { data: rows, error } = await supabase
    .from(table)
    .upsert(payload, {
      onConflict: "user_id,idempotency_key",
      ignoreDuplicates: true,
    })
    .select(selectColumns)

  if (error) throw new Error(`idempotent upsert failed (${table}): ${error.message}`, { cause: error })

  if (rows && rows.length > 0) {
    return { row: rows[0] as unknown as T, created: true }
  }

  // Conflict — another caller won the race. SELECT their canonical row.
  const { data: existing, error: selectError } = await supabase
    .from(table)
    .select(selectColumns)
    .eq("user_id", data.user_id)
    .eq("idempotency_key", idempotencyKey)
    .single()

  // `.single()` reports "no row" as PGRST116: the winner's row is gone (deleted
  // between the conflict and this read — a refused reservation, the Trash).
  if ((selectError && selectError.code === NO_ROW) || (!selectError && !existing)) {
    throw new IdempotencyWinnerGoneError(table, data.user_id, idempotencyKey)
  }
  if (selectError) {
    throw new Error(
      `idempotency conflict on ${table} but post-conflict SELECT failed: ${selectError.message}`,
    )
  }
  return { row: existing as unknown as T, created: false }
}

/**
 * The row an earlier request already wrote under `(user_id, idempotency_key)`,
 * or `null` — the row `insertWithIdempotencyKey` would answer a retry with,
 * read before a check that would otherwise refuse that retry (a balance its
 * own run has since spent). A read, so racy on its own: the insert stays the
 * race-proof backstop. Throws on a read error.
 */
export async function findIdempotentRow<T>(
  table: string,
  userId: string,
  idempotencyKey: string,
  selectColumns: string = "id",
): Promise<T | null> {
  const { data, error } = await supabase
    .from(table)
    .select(selectColumns)
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle()
  if (error) throw new Error(`idempotency lookup failed (${table}): ${error.message}`, { cause: error })
  return (data as unknown as T | null) ?? null
}
