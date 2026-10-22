/**
 * The listing's estimate flag (migration 553, metered LLM pricing Task 12 /
 * R47): `estimated_credits_is_estimate` on `published_apps` and
 * `workflow_templates` — the stored price holds a metered LLM call's estimate
 * (charged its actual usage), so a card shows it `~N`.
 *
 * Staging runs dev against the SHARED database and migrations apply only at the
 * dev→main promotion, so for that window the column does not exist and a
 * statement that names it fails whole. Like the "up to" and per-minute columns
 * (`listing-max-columns.ts`, `listing-per-minute-columns.ts`): on an error
 * naming it as missing it is remembered as absent for `ESTIMATE_FLAG_ABSENT_TTL_MS`,
 * a read retries without it and a write is retried without it — dropped: the
 * price is still true, the card simply shows no `~` in that window.
 * Composes with the other helpers: pass their read or write as `build`/`write`.
 */
import { llmMeteredPricing } from "./config.js"
import { isMissingColumnError } from "./postgrest-errors.js"

export type EstimateFlagTable = "published_apps" | "workflow_templates"

export const LISTING_ESTIMATE_FLAG_COLUMN = "estimated_credits_is_estimate"

/** How long a missing-column answer is trusted before the column is asked for again. */
export const ESTIMATE_FLAG_ABSENT_TTL_MS = 5 * 60_000

const absentSince: Record<EstimateFlagTable, number | undefined> = { published_apps: undefined, workflow_templates: undefined }

function isAbsent(table: EstimateFlagTable): boolean {
  const since = absentSince[table]
  return since !== undefined && Date.now() - since < ESTIMATE_FLAG_ABSENT_TTL_MS
}

type PgError = { code?: string | null; message?: string } | null

/** True when `error` says the flag column does not exist (and records it). Any other error: false. */
export function noteEstimateFlagColumnError(table: EstimateFlagTable, error: PgError | undefined): boolean {
  if (!isMissingColumnError(error)) return false
  if (!new RegExp(`(?<![A-Za-z0-9_])${LISTING_ESTIMATE_FLAG_COLUMN}(?![A-Za-z0-9_])`).test(error?.message ?? "")) return false
  absentSince[table] = Date.now()
  return true
}

/** `columns` plus the flag column, unless it is known to be missing. */
export function withEstimateFlagColumn(table: EstimateFlagTable, columns: string): string {
  return isAbsent(table) ? columns : `${columns}, ${LISTING_ESTIMATE_FLAG_COLUMN}`
}

/** Select with the flag column, retrying once without it on a missing-column error naming it. */
export async function selectWithEstimateFlag<T>(
  table: EstimateFlagTable,
  columns: string,
  build: (columns: string) => PromiseLike<{ data: unknown; error: PgError; count?: number | null }>,
): Promise<{ data: T | null; error: PgError; count?: number | null }> {
  const named = !isAbsent(table)
  const first = await build(withEstimateFlagColumn(table, columns))
  const result = named && first.error && noteEstimateFlagColumnError(table, first.error) ? await build(columns) : first
  return result as { data: T | null; error: PgError; count?: number | null }
}

/** `row` without the flag column. */
export function withoutEstimateFlag<R extends Record<string, unknown>>(row: R): R {
  const out: Record<string, unknown> = { ...row }
  delete out[LISTING_ESTIMATE_FLAG_COLUMN]
  return out as R
}

/** Write a row that carries the flag: without it when it is known to be missing, and again without it on a missing-column error. */
export async function writeWithEstimateFlag<R extends Record<string, unknown>, Res extends { error: PgError }>(
  table: EstimateFlagTable,
  row: R,
  write: (row: R) => PromiseLike<Res>,
  /** A row written without the flag (the seeder marks it stale, so a later boot writes it whole). */
  whenDropped: (row: R) => R = (r) => r,
): Promise<Res> {
  if (isAbsent(table)) return write(whenDropped(withoutEstimateFlag(row)))
  const first = await write(row)
  if (first.error && noteEstimateFlagColumnError(table, first.error)) return write(whenDropped(withoutEstimateFlag(row)))
  return first
}

/** The column a writer stores from a listing's own flag (`AppListingEstimate.estimate`). */
export function estimateFlagColumn(listing: { readonly estimate?: boolean }): { estimated_credits_is_estimate: boolean } {
  return { [LISTING_ESTIMATE_FLAG_COLUMN]: listing.estimate === true } as { estimated_credits_is_estimate: boolean }
}

/**
 * The flag a reader serves for a stored row: `estimatedCreditsIsEstimate: true`
 * only when the row says so AND metered pricing is on (under the rollback no
 * figure is an estimate, whatever was stored); absent otherwise, so a fixed or
 * rolled-back answer is byte-identical to before.
 */
export function listingEstimateFlag(row: Readonly<Record<string, unknown>> | null | undefined): { estimatedCreditsIsEstimate?: true } {
  return row?.[LISTING_ESTIMATE_FLAG_COLUMN] === true && llmMeteredPricing() ? { estimatedCreditsIsEstimate: true } : {}
}

/** For tests: forget what the process learned. */
export function resetEstimateFlagColumnForTest(): void {
  absentSince.published_apps = undefined
  absentSince.workflow_templates = undefined
}
