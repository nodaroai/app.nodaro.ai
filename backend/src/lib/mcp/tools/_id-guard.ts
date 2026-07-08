import { z } from "zod"

const uuidSchema = z.string().uuid()

/**
 * True when `id` is a well-formed UUID — the shape of every `jobs` /
 * `workflow_executions` primary key.
 *
 * By-id MCP read tools (`get_job`, `get_asset`, `display_asset`, …) filter
 * with `.eq("id", id)` against a Postgres `uuid` column. A non-UUID value
 * (a KIE task id, an app-run id, a truncated id, a pasted URL) makes
 * Postgres throw `invalid input syntax for type uuid: "…"`, which the tool
 * would otherwise forward verbatim — a confusing, internals-leaking error.
 * Guard with this first and return a clean "not found" instead: a value
 * that can't be a UUID definitionally isn't a row we have.
 */
export function isUuid(id: string): boolean {
  return uuidSchema.safeParse(id).success
}
