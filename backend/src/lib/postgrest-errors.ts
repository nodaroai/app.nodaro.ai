/**
 * PostgREST's "no such column" — schema-cache `PGRST204`, or Postgres
 * `42703` once the statement runs. A column that arrives with a migration
 * reaches the shared database only when `main` deploys, and staging runs
 * ahead of it; a writer that can live without the column checks this and
 * writes again without it (the safe answer is always the column's default).
 */
export function isMissingColumnError(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "PGRST204" || error?.code === "42703"
}

/**
 * "No such table" — Postgres `42P01` once the statement runs, or PostgREST's
 * schema-cache `PGRST205` before it does. A table that arrives with a
 * migration reaches the shared database only when `main` deploys, so a route
 * for a newer feature reads it as "nothing yet", never as a server error.
 */
export function isMissingTableError(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205"
}

/**
 * "The function is not in the database yet" — PostgREST's schema-cache
 * `PGRST202`, Postgres `42883` once the statement runs, or the message either
 * one carries. Migrations reach the database on a push to main, so staging
 * runs code that calls a new function for days before it exists.
 */
export function isMissingFunctionError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false
  const record = err as { code?: unknown; message?: unknown }
  if (record.code === "PGRST202" || record.code === "42883") return true
  return typeof record.message === "string" && /could not find the function/i.test(record.message)
}
