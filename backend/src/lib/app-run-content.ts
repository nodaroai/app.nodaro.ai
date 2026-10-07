/**
 * The `app_runs` columns that hold a runner's own content — what the admin
 * expunge erases from every run of an app while keeping the run record
 * (credits, dates, the app-name snapshots) for earnings and audit.
 *
 * - `input_values` (migration 047): the inputs the runner entered, including
 *   the urls of media they uploaded.
 * - `node_states` (migration 082): results the runner edited after the run,
 *   merged over the execution's own node states — more media urls.
 * - `name` (migration 049): the label the runner typed for the run — free
 *   text that can carry personal data. Not a url, so the harvest skips it.
 *
 * One list for both halves of expunge: the R2-key harvest reads these
 * columns, and the redact step clears them. Every name here must exist on the
 * table, and every `app_runs` column must be either in this list or
 * deliberately kept — `lib/__tests__/app-run-content-columns.test.ts` checks
 * both against the migrations.
 */
export const APP_RUN_USER_CONTENT_COLUMNS = ["input_values", "node_states", "name"] as const

export type AppRunUserContentColumn = (typeof APP_RUN_USER_CONTENT_COLUMNS)[number]

/** The redact patch: every user-content column set to NULL. */
export function appRunContentRedaction(): Record<AppRunUserContentColumn, null> {
  return Object.fromEntries(APP_RUN_USER_CONTENT_COLUMNS.map((column) => [column, null])) as Record<
    AppRunUserContentColumn,
    null
  >
}
