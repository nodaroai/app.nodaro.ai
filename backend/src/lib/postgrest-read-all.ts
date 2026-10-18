/**
 * Every row of a PostgREST select, read page by page.
 *
 * PostgREST caps one response at the project's `max_rows` (1000 by default,
 * lower if configured) and says nothing when it does: the response is simply
 * the first rows, with no error. A select that expects the whole table quietly
 * loses everything past the cap — `GET /v1/admin/models` lost the cheapest
 * `model_pricing` rows that way once the table passed 1000 rows.
 *
 * So the next page starts after the last row actually received, never at a
 * fixed offset, and the read stops only on an EMPTY page: under a `max_rows`
 * smaller than the page asked for, every page is "short", and stopping on a
 * short page would end after the first one. The same rule as
 * `ee/billing/credits.ts :: readModelPricingRows`.
 *
 * The query must have a TOTAL order (end it on a unique column): with ties,
 * Postgres may order the tied rows differently from one page to the next, and
 * a page seam can then repeat one row and skip another.
 *
 * The caller builds the query, so the table name stays at the call site where
 * the tenant-scope and admin-client lints read it.
 */

/** The slice of a PostgREST response a page read needs. */
export interface PageResult<Row> {
  data: Row[] | null
  error: { message: string } | null
}

/** Rows requested per page. The server may answer fewer (its `max_rows`); the loop copes. */
export const READ_ALL_PAGE_SIZE = 1000

/**
 * Reads every row `page(from, to)` yields. `page` must apply `.range(from, to)`
 * to a totally ordered select. The first page error ends the read with that
 * error and NO rows — a partial list would pass for the whole table.
 */
export async function readAllRows<Row>(
  page: (from: number, to: number) => PromiseLike<PageResult<Row>>,
  pageSize: number = READ_ALL_PAGE_SIZE,
): Promise<{ data: Row[]; error: null } | { data: null; error: { message: string } }> {
  const rows: Row[] = []
  for (let from = 0; ; ) {
    const { data, error } = await page(from, from + pageSize - 1)
    if (error) return { data: null, error }
    const got = data ?? []
    if (got.length === 0) return { data: rows, error: null }
    rows.push(...got)
    from += got.length
  }
}
