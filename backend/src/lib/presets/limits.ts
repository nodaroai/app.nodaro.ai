import type { FastifyReply, FastifyRequest } from "fastify"
import { supabase } from "../supabase.js"

/**
 * How much one user may keep, and change at once, in their node presets
 * (decided 2026-10-15, when the writes opened to API keys and OAuth apps).
 *
 * A person in the editor saves presets one at a time; a script can loop. The
 * caps sit far above what the editor ever reaches, so it never meets one, and
 * every refusal is a clear 409 `limit_reached` naming the cap — never a
 * half-written import.
 */
export const MAX_PRESETS_PER_USER = 5_000
export const MAX_PRESET_GROUPS_PER_USER = 500
export const MAX_PRESET_FAVORITES_PER_USER = 2_000

/**
 * The most rows one reorder may move. The editor's Manage dialog sends a whole
 * node type's list on every drop, so a session keeps the long-standing bound;
 * a key or an app moves at most this much per call — a reorder is one update
 * per row, run a few at a time (`REORDER_CONCURRENCY`).
 */
export const REORDER_LIMITS = {
  session: { presets: 2_000, groups: 500 },
  programmatic: { presets: 500, groups: 100 },
} as const

/** How many reorder updates run at once. */
export const REORDER_CONCURRENCY = 8

/** The reorder bounds for this caller. */
export function reorderLimitsFor(req: FastifyRequest): { presets: number; groups: number } {
  return req.authKind === "jwt" ? REORDER_LIMITS.session : REORDER_LIMITS.programmatic
}

/** How many rows `userId` owns in `table`. Throws when the count cannot be read. */
export async function countOwned(
  table: "node_presets" | "node_preset_groups" | "node_preset_favorites",
  userId: string,
): Promise<number> {
  const { count, error } = await supabase.from(table).select("user_id", { count: "exact", head: true }).eq("user_id", userId)
  if (error) throw new Error(`count of ${table} failed: ${error.message}`)
  return count ?? 0
}

export function sendLimitReached(reply: FastifyReply, message: string): FastifyReply {
  return reply.status(409).send({ error: { code: "limit_reached", message } })
}

/** Runs `fn` over `items`, `size` at a time, and returns every result in order. */
export async function inBatches<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(fn))))
  }
  return results
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether a path id can name a row at all (a malformed one is a 404, never a database error). */
export function isUuid(id: string): boolean {
  return UUID.test(id)
}
