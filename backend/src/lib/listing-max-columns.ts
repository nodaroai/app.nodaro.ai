/**
 * The "up to" listing columns (migration 517, decided 2026-10-14): a listing's
 * price is a range — "from" the existing columns (the saved settings), "up to"
 * these (the most a run can cost over the choices the app's user has).
 *
 *   published_apps     base_max_estimated_credits / max_estimated_credits,
 *                      base_max_per_minute_credits / max_per_minute_credits,
 *                      base_max_per_item_credits / max_per_item_credits
 *   workflow_templates max_estimated_credits / max_estimated_per_minute_credits
 *
 * NULL means "not computed" (a row stored before them, not yet backfilled):
 * the listing shows its "from" figure alone.
 *
 * Staging runs dev against the SHARED database and migrations apply only at the
 * dev→main promotion, so for that window the columns do not exist and a
 * statement that names one fails whole. Every site that names them goes
 * through here (a guard test enforces it), exactly like the per-minute columns
 * (`listing-per-minute-columns.ts`): on an error naming one as missing they are
 * remembered as absent for `MAX_ABSENT_TTL_MS`, a read retries without them
 * and a write is retried without them — dropped, nothing folded: the "from"
 * figure is still true, the listing simply shows no "up to" in that window.
 * Composes with the per-minute helper: pass its read or write as `build`/`write`.
 */
import { isMissingColumnError } from "./postgrest-errors.js"

export type MaxTable = "published_apps" | "workflow_templates"

/** Each table's "up to" columns, read and written together. */
export const MAX_COLUMNS: Readonly<Record<MaxTable, readonly string[]>> = {
  published_apps: [
    "base_max_estimated_credits", "max_estimated_credits",
    "base_max_per_minute_credits", "max_per_minute_credits",
    "base_max_per_item_credits", "max_per_item_credits",
  ],
  workflow_templates: ["max_estimated_credits", "max_estimated_per_minute_credits"],
}

/** The columns a public listing shows: the listed "up to" prices (never the fee's bases). */
export const LISTED_MAX_COLUMNS: Readonly<Record<MaxTable, readonly string[]>> = {
  published_apps: ["max_estimated_credits", "max_per_minute_credits", "max_per_item_credits"],
  workflow_templates: ["max_estimated_credits", "max_estimated_per_minute_credits"],
}

/** Which of a table's "up to" columns a read names: all of them, or the listed prices alone. */
export type MaxRead = "all" | "listed"

/** How long a missing-column answer is trusted before the columns are asked for again. */
export const MAX_ABSENT_TTL_MS = 5 * 60_000

const absentSince: Record<MaxTable, number | undefined> = { published_apps: undefined, workflow_templates: undefined }

function isAbsent(table: MaxTable): boolean {
  const since = absentSince[table]
  return since !== undefined && Date.now() - since < MAX_ABSENT_TTL_MS
}

type PgError = { code?: string | null; message?: string } | null

function namesColumn(message: string, columns: readonly string[]): boolean {
  return columns.some((column) => new RegExp(`(?<![A-Za-z0-9_])${column}(?![A-Za-z0-9_])`).test(message))
}

/** True when `error` says one of the table's "up to" columns does not exist (and records it). Any other error: false. */
export function noteMaxColumnError(table: MaxTable, error: PgError | undefined): boolean {
  if (!isMissingColumnError(error)) return false
  if (!namesColumn(error?.message ?? "", MAX_COLUMNS[table])) return false
  absentSince[table] = Date.now()
  return true
}

/** `columns` plus the table's "up to" columns, unless they are known to be missing. */
export function withMaxColumns(table: MaxTable, columns: string, read: MaxRead = "all"): string {
  if (isAbsent(table)) return columns
  return `${columns}, ${(read === "listed" ? LISTED_MAX_COLUMNS[table] : MAX_COLUMNS[table]).join(", ")}`
}

/** Select with the "up to" columns, retrying once without them on a missing-column error naming one. */
export async function selectWithMax<T>(
  table: MaxTable,
  columns: string,
  build: (columns: string) => PromiseLike<{ data: unknown; error: PgError; count?: number | null }>,
  read: MaxRead = "all",
): Promise<{ data: T | null; error: PgError; count?: number | null }> {
  const named = !isAbsent(table)
  const first = await build(withMaxColumns(table, columns, read))
  const result = named && first.error && noteMaxColumnError(table, first.error) ? await build(columns) : first
  return result as { data: T | null; error: PgError; count?: number | null }
}

/** `row` without the table's "up to" columns. */
export function withoutMax<R extends Record<string, unknown>>(table: MaxTable, row: R): R {
  const out: Record<string, unknown> = { ...row }
  for (const column of MAX_COLUMNS[table]) delete out[column]
  return out as R
}

/** Write a row that carries the "up to" columns: without them when they are known to be missing, and again without them on a missing-column error. */
export async function writeWithMax<R extends Record<string, unknown>, Res extends { error: PgError }>(
  table: MaxTable,
  row: R,
  write: (row: R) => PromiseLike<Res>,
): Promise<Res> {
  if (isAbsent(table)) return write(withoutMax(table, row))
  const first = await write(row)
  if (first.error && noteMaxColumnError(table, first.error)) return write(withoutMax(table, row))
  return first
}

/** An "up to" column's value on a row: a whole number of credits, or undefined when not computed (NULL, absent). */
export function maxOf(row: Readonly<Record<string, unknown>> | null | undefined, column: string): number | undefined {
  const v = row?.[column]
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined
}

/** For tests: forget what the process learned. */
export function resetMaxColumnsForTest(): void {
  absentSince.published_apps = undefined
  absentSince.workflow_templates = undefined
}
