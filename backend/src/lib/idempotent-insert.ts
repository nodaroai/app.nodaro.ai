import { supabase } from "./supabase.js"

export interface IdempotentInsertResult<T> {
  row: T
  /** True if this call won the race and inserted the row. False if a prior
   *  call had already inserted a row with the same (user_id, idempotency_key)
   *  and this call observed it. Callers use this to decide whether to set the
   *  `X-Dedup-Hit` response header / mark the API response as a deduped echo. */
  created: boolean
}

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
 * Throws on unexpected DB errors. The conflict-then-empty path is NOT an
 * error — it's the documented success outcome of `ignoreDuplicates: true`.
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
    if (error) throw new Error(`insert into ${table} failed: ${error.message}`)
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

  if (error) throw new Error(`upsert into ${table} failed: ${error.message}`)

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

  if (selectError) {
    throw new Error(
      `idempotency conflict on ${table} but post-conflict SELECT failed: ${selectError.message}`,
    )
  }
  if (!existing) {
    throw new Error(
      `idempotency conflict on ${table} for user=${data.user_id} key=${idempotencyKey} but no row found`,
    )
  }
  return { row: existing as unknown as T, created: false }
}
