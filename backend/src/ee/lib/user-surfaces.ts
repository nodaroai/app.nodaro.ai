import type { PresenceEntry, PresenceStore } from "./presence.js"

/**
 * The surfaces each account has used, kept in the database for good: the
 * durable sibling of the "Signed in now" notes (presence.ts), which live in
 * Redis for fifteen minutes and nowhere else. The same entries, the same
 * recorder, a far longer throttle: one `touch_user_surface` call (migration
 * 607) per user and surface per hour per process. Several replicas each keep
 * their own hour, so a surface may be touched a few times an hour; the
 * function's upsert absorbs that, and `touches` counts touches, not requests.
 */
export const USER_SURFACE_WRITE_EVERY_MS = 60 * 60_000

/** After a failed write, the next try for that user and surface: a database's
 *  failures last (a migration not yet applied), and one call a minute says so
 *  without one call per request. */
export const USER_SURFACE_RETRY_AFTER_MS = 60_000

/** The one call this store makes, as the Supabase client exposes it. */
export interface SurfaceRpc {
  rpc(
    fn: "touch_user_surface",
    args: { p_user_id: string; p_source: string; p_detail: string },
  ): PromiseLike<{ error: { message: string } | null }>
}

/** A store the presence recorder can write to; it never reads, so there is no `since`. */
export function createUserSurfaceStore(client: SurfaceRpc): Pick<PresenceStore, "put"> {
  return {
    async put(entry: PresenceEntry): Promise<void> {
      const { error } = await client.rpc("touch_user_surface", {
        p_user_id: entry.userId,
        p_source: entry.source,
        // A surface with nothing more to say is the empty detail: part of the row's key.
        p_detail: entry.detail ?? "",
      })
      if (error) throw new Error(error.message)
    },
  }
}
