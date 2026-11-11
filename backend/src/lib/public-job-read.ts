/**
 * Which jobs a person may read by id: their own, and anyone's PUBLIC completed
 * one (what the public gallery shows) — unless the deployment does not allow
 * public work (`outputs.allowPublic: false`, `surfaceAllowsPublicOutputs`).
 * There no job is public to anyone but its owner, so these narrow to the
 * caller's own: a row marked public before the switch was set, or carried over
 * in a copied database, reads as one that does not exist, as on the gallery's
 * listings.
 *
 * The one place a read of another person's job by `is_public` is written, so
 * the MCP asset reads (`get_asset`, `display_asset`, `list_favorites`), the
 * favorite toggle (REST and MCP) and the Suno follow-ups agree.
 * `lib/__tests__/public-outputs-reads-totality.test.ts` fails a new inline
 * `is_public` read of other people's jobs anywhere else.
 */
import { surfaceAllowsPublicOutputs } from "./surface-profile.js"

/** As a PostgREST `or()` filter. */
export function readableJobsFilter(userId: string): string {
  return surfaceAllowsPublicOutputs() ? `user_id.eq.${userId},and(is_public.eq.true,status.eq.completed)` : `user_id.eq.${userId}`
}

/** As a check on a job row already read (`user_id`, `is_public` and `status` selected). */
export function jobReadableBy(row: { user_id?: unknown; is_public?: unknown; status?: unknown }, userId: string): boolean {
  if (row.user_id === userId) return true
  return row.is_public === true && row.status === "completed" && surfaceAllowsPublicOutputs()
}
