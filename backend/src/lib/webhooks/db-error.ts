/**
 * A database error as a log line may carry it: its code (SQLSTATE or
 * PostgREST), else the first line of its message (a fetch failure has no
 * code). Never its `details` or `hint`: a constraint violation's details quote
 * the failing row — an endpoint's address, its sealed secret, a kept event
 * body.
 */
export function describeDbError(error: unknown): string {
  const e = (error ?? {}) as { code?: unknown; message?: unknown }
  if (typeof e.code === "string" && e.code) return e.code
  const first = typeof e.message === "string" ? e.message.split("\n")[0]?.trim() : ""
  return first ? first.slice(0, 120) : "unknown error"
}
