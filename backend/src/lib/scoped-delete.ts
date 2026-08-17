/**
 * The result of a DELETE scoped by owner — `.delete().eq("id", …).eq("user_id", …)`.
 *
 * Every such statement is safe (a foreign row is simply not matched) but it
 * is silent about it: Supabase reports no error for zero affected rows, and
 * a route that answers `{ success: true }` right after tells a caller who
 * does not own the row that it deleted something. GET and PATCH on the same
 * foreign id answer 404; DELETE must too — the SDK, the CLI and the tests
 * read the status, and a lying 200 masks bugs (release check 31, #699).
 *
 * Use with `.select("id")` on the delete so PostgREST returns the rows it
 * removed, then hand the result here:
 *
 *   const { data, error } = await supabase.from("faces").delete()
 *     .eq("id", id).eq("user_id", userId).select("id")
 *   if (error) return sendInternalError(reply, req, error, "Failed to delete face")
 *   if (deletedNothing(data)) return sendNotFound(reply, "Face not found")
 *   return { success: true }
 *
 * Deliberately NOT for idempotent clears (favorites, provider keys) — those
 * mean "make sure it is gone" and 200 on nothing-to-do is the right answer.
 */
import type { FastifyReply } from "fastify"

export function deletedNothing(rows: ReadonlyArray<unknown> | null | undefined): boolean {
  return !rows || rows.length === 0
}

export function sendNotFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.status(404).send({ error: { code: "not_found", message } })
}
