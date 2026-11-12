/**
 * A ROW OF `assets` IS A FILE ONLY WHEN IT HAS AN ADDRESS (decided 2026-11-12).
 *
 * `assets.r2_url` is nullable (migration 179): a retention reaper
 * (`ee/billing/cleanup-service.ts`, `reapAssetBatch`) deletes an aged file's
 * object and keeps its row, clearing `r2_key` and `r2_url` (the storage it held
 * is given back to the user's total as it goes). Such a row has no file to
 * show, so no listing hands it to a client: every listing of `assets` rows —
 * its page and its count alike — applies {@link onlyAssetFiles} in the query,
 * which keeps paging, cursors and `totalCount` describing the same list.
 * Nothing is deleted. `asset-file-reads.test.ts` holds every user-facing read
 * that answers an address or a count to the rule, or to a stated reason.
 *
 * A leaf module, like `content-restrictions-column.ts`: a route or a tool can
 * apply the rule without loading anything else (the one import is a type).
 */
import type { PostgrestFilterBuilder } from "@supabase/supabase-js"

/** The column that holds a file's address; a row without one is no file. */
export const ASSET_ADDRESS_COLUMN = "r2_url"

/** Any filter builder of the (untyped) service client: what `.from(…).select(…)` answers. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFilterBuilder = PostgrestFilterBuilder<any, any, any, any, any, any, any>

/**
 * `query` kept to the rows that are files: an address that is set and not
 * blank. Wrap the `.from("assets")` chain itself (the guard reads it there):
 *
 *   let query = onlyAssetFiles(
 *     supabase
 *       .from("assets")
 *       .select(…),
 *   )
 *
 * (`neq` alone would leave a NULL out as well, a comparison with NULL being
 * no match; the NULL test is spelled out so nobody has to know that.)
 */
export function onlyAssetFiles<Q extends AnyFilterBuilder>(query: Q): Q {
  return query.not(ASSET_ADDRESS_COLUMN, "is", null).neq(ASSET_ADDRESS_COLUMN, "")
}
