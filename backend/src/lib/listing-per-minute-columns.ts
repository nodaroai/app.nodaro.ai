/**
 * The per-minute listing columns (migration 483, decided 2026-10-07):
 * `published_apps.base_per_minute_credits` / `per_minute_credits` and
 * `workflow_templates.estimated_per_minute_credits` — a listing's credits per
 * minute of the episode, beside the fixed price the existing columns hold.
 *
 * Staging runs dev against the SHARED database, and migrations apply only at
 * the dev→main promotion — so for that window the columns do not exist, and a
 * read or write that names one fails the WHOLE statement (a publish, the
 * marketplace browse). Every site that names them goes through here (a guard
 * test enforces it): on an error that names one of them as missing, the
 * table's columns are remembered as absent for `PER_MINUTE_ABSENT_TTL_MS`, a
 * read retries without them and a write is retried without them. Absent reads
 * as 0 per minute.
 *
 * The memo expires because staging is NOT restarted when the migration
 * applies: it applies in the migrate job of the dev→main promotion, which
 * redeploys production only. A process that learned "absent" before then
 * would otherwise list every per-minute listing at its fixed part alone (82
 * credits for a run that costs up to 2602) until the next push to dev. Once
 * the memo expires the next statement names the columns again: while they are
 * still missing that costs one failed statement per table per period, then the
 * retry. An error that names some OTHER missing column (another open PR's
 * column in the same select) is not theirs: it is handed back to the caller.
 *
 * A write without the columns FOLDS the per-minute part into the fixed price
 * at the longest recording (180 minutes): the code production runs in that
 * window knows no per-minute part, and must read the figure it always read —
 * never the fixed part alone, which would under-quote every per-minute
 * listing (Tighten Episode at 82 credits instead of 2602). Once the columns
 * exist that row reads as 0 per minute at its old ceiling price, until its
 * next publish.
 */
import { EDIT_PLAN_MAX_MINUTES } from "@nodaro/shared"
import { isMissingColumnError } from "./postgrest-errors.js"

export type PerMinuteTable = "published_apps" | "workflow_templates"

/** Each table's per-minute columns — and, on `published_apps`, the per-item
 *  pair the same migration adds (decided 2026-10-07: a List the app's user
 *  fills is listed per further item). Read and written together. */
export const PER_MINUTE_COLUMNS: Readonly<Record<PerMinuteTable, readonly string[]>> = {
  published_apps: ["base_per_minute_credits", "per_minute_credits", "base_per_item_credits", "per_item_credits"],
  workflow_templates: ["estimated_per_minute_credits"],
}

/** The column a public listing shows: the listed per-minute price (never the fee's base). */
export const LISTED_PER_MINUTE_COLUMN: Readonly<Record<PerMinuteTable, string>> = {
  published_apps: "per_minute_credits",
  workflow_templates: "estimated_per_minute_credits",
}

/** Every listed (never the fee's base) column a public read names: the
 *  per-minute price, and an app's per-item price. */
export const LISTED_COLUMNS: Readonly<Record<PerMinuteTable, readonly string[]>> = {
  published_apps: ["per_minute_credits", "per_item_credits"],
  workflow_templates: ["estimated_per_minute_credits"],
}

/**
 * Columns migration 483 adds that a statement names without reading them as
 * a price part: `workflow_templates.typical_episode_credits`, the generated
 * column the gallery's "cheapest first" sort orders by. A missing-column error
 * naming one is the same missing migration.
 */
export const PER_MINUTE_SORT_COLUMN: Readonly<Partial<Record<PerMinuteTable, string>>> = {
  workflow_templates: "typical_episode_credits",
}

/** Which of a table's per-minute columns a read names: all of them, or the listed price alone. */
export type PerMinuteRead = "all" | "listed"

/** How long a missing-column answer is trusted before the columns are asked for again. */
export const PER_MINUTE_ABSENT_TTL_MS = 5 * 60_000

/** When each table's per-minute columns were last found missing (undefined: not known to be). */
const absentSince: Record<PerMinuteTable, number | undefined> = { published_apps: undefined, workflow_templates: undefined }

/** Are the table's per-minute columns known to be missing (found so within the time limit)? */
function isAbsent(table: PerMinuteTable): boolean {
  const since = absentSince[table]
  return since !== undefined && Date.now() - since < PER_MINUTE_ABSENT_TTL_MS
}

type PgError = { code?: string | null; message?: string } | null

/** Does `message` name one of `columns` as a whole name (a `table.` prefix or quotes around it are fine)? */
function namesColumn(message: string, columns: readonly string[]): boolean {
  return columns.some((column) => new RegExp(`(?<![A-Za-z0-9_])${column}(?![A-Za-z0-9_])`).test(message))
}

/**
 * True when `error` says one of the TABLE's per-minute columns does not exist
 * (and records it for `table`). A missing-column error that names another
 * column is the caller's: false, nothing recorded.
 */
export function notePerMinuteColumnError(table: PerMinuteTable, error: PgError | undefined): boolean {
  if (!isMissingColumnError(error)) return false
  const sortColumn = PER_MINUTE_SORT_COLUMN[table]
  if (!namesColumn(error?.message ?? "", sortColumn ? [...PER_MINUTE_COLUMNS[table], sortColumn] : PER_MINUTE_COLUMNS[table])) return false
  absentSince[table] = Date.now()
  return true
}

/** `columns` plus the table's per-minute columns, unless they are known to be missing. */
export function withPerMinuteColumns(table: PerMinuteTable, columns: string, read: PerMinuteRead = "all"): string {
  if (isAbsent(table)) return columns
  return `${columns}, ${(read === "listed" ? LISTED_COLUMNS[table] : PER_MINUTE_COLUMNS[table]).join(", ")}`
}

/**
 * Select with the per-minute columns, retrying once without them on a
 * missing-column error. `build` receives the column list, and whether the
 * per-minute columns are in it (a sort on `PER_MINUTE_SORT_COLUMN` must then
 * fall back too), and returns the awaited query.
 */
export async function selectWithPerMinute<T>(
  table: PerMinuteTable,
  columns: string,
  // A column list built at run time types its rows as unknown: the caller names T.
  build: (columns: string, perMinute: boolean) => PromiseLike<{ data: unknown; error: PgError; count?: number | null }>,
  read: PerMinuteRead = "all",
): Promise<{ data: T | null; error: PgError; count?: number | null }> {
  const named = !isAbsent(table)
  const first = await build(withPerMinuteColumns(table, columns, read), named)
  const result = named && first.error && notePerMinuteColumnError(table, first.error) ? await build(columns, false) : first
  return result as { data: T | null; error: PgError; count?: number | null }
}

/** Each per-minute column and the fixed column it folds into when it cannot be written. */
const FOLDS_INTO: Readonly<Record<PerMinuteTable, Readonly<Record<string, string>>>> = {
  published_apps: { base_per_minute_credits: "base_estimated_credits", per_minute_credits: "estimated_credits" },
  workflow_templates: { estimated_per_minute_credits: "estimated_credits" },
}

/**
 * `row` without the table's per-minute columns, each folded into its fixed
 * column at the longest recording (`EDIT_PLAN_MAX_MINUTES`): the price the
 * listing stored before it was split. A fixed column the row does not write
 * is left out (an update of other fields). The per-item pair has no ceiling to
 * fold at (a list has no longest length), so it is dropped: in that window an
 * app lists its saved items alone, as it did before the pair existed.
 */
export function withoutPerMinute<R extends Record<string, unknown>>(table: PerMinuteTable, row: R): R {
  const out: Record<string, unknown> = { ...row }
  for (const column of PER_MINUTE_COLUMNS[table]) if (!(column in FOLDS_INTO[table])) delete out[column]
  for (const [column, fixed] of Object.entries(FOLDS_INTO[table])) {
    const perMinute = out[column]
    delete out[column]
    if (typeof perMinute === "number" && perMinute > 0 && typeof out[fixed] === "number") {
      out[fixed] = (out[fixed] as number) + perMinute * EDIT_PLAN_MAX_MINUTES
    }
  }
  return out as R
}

/**
 * Write a row that carries the per-minute columns: without them (folded, see
 * `withoutPerMinute`) when they are known to be missing, and again without
 * them on a missing-column error. `write` receives the row and returns the
 * awaited statement; `whenFolded` adjusts a row written without the columns
 * (the seeder marks it stale, so the first boot with the columns rewrites it).
 */
export async function writeWithPerMinute<R extends Record<string, unknown>, Res extends { error: PgError }>(
  table: PerMinuteTable,
  row: R,
  write: (row: R) => PromiseLike<Res>,
  whenFolded: (row: R) => R = (r) => r,
): Promise<Res> {
  if (isAbsent(table)) return write(whenFolded(withoutPerMinute(table, row)))
  const first = await write(row)
  if (first.error && notePerMinuteColumnError(table, first.error)) return write(whenFolded(withoutPerMinute(table, row)))
  return first
}

/** A per-minute column's value on a row: a whole number of credits, 0 when absent. */
export function perMinuteOf(row: Readonly<Record<string, unknown>> | null | undefined, column: string): number {
  const v = row?.[column]
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0
}

/** For tests: forget what the process learned. */
export function resetPerMinuteColumnsForTest(): void {
  absentSince.published_apps = undefined
  absentSince.workflow_templates = undefined
}
