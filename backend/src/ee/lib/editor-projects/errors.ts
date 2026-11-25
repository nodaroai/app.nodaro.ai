import type { FastifyReply, FastifyRequest } from "fastify"
import { sendInternalError } from "../../../lib/http-errors.js"
import { isMissingFunctionError, isMissingTableError } from "../../../lib/postgrest-errors.js"
import { EditorProjectRefusal, refuse } from "./refusal.js"

/**
 * The one mapping from what can go wrong in an editor-project route to what
 * the editor is told. Every refusal is `{ error: "<code>" }` (the editor reads
 * the code), and everything else is a sanitized 500.
 *
 *   not_found       404  no such project of the caller's (another user's
 *                        project included, never 403; a malformed id too)
 *   not_holder      409  this tab does not hold the edit claim
 *   held_elsewhere  409  another live tab holds it (claim refused)
 *   base_mismatch   409  a PATCH computed from content that is no longer the
 *                        saved one (raised by the save, or found by the route)
 *   invalid_holder  400  a holder that is not 8–64 of [A-Za-z0-9_-]
 *   invalid_content 400  a content hash that is not 64 lowercase hex
 *   not_available   503  this database has no editor-project tables or
 *                        functions yet (migration 703 not applied), or this
 *                        deployment has no private bucket for project files
 *   file_missing    500  a saved project whose content file is not in
 *                        storage (never answered with another file instead,
 *                        and a same-content save is never answered "saved").
 *                        A save of the same content cannot repair it (the
 *                        database does not repoint a row for the hash it
 *                        holds); a whole save of any different content does,
 *                        after which the original content can be saved again
 *   too_complex     422  a save whose own work would be too costly: a patch
 *                        with more than 2,000 add / remove on an array index,
 *                        or work past the heavy-work thread's time or memory
 *                        limit (send the content whole, or smaller)
 *   too_many_projects 409  creating past the live projects one person may hold
 *   project_storage_full 413  a save, cut or restore that would take the
 *                        person's stored project files past the ceiling
 *                        (storage-ceiling.ts); an x-cut-version cut is
 *                        skipped instead
 *   busy            429  another heavy request of this user's is running on
 *                        this instance, or no heavy-work thread came free in
 *                        time (`retry-after: 1`)
 *   version_unreadable 500  a version whose stored file, or the whole version
 *                        a patch version is against, is missing or does not
 *                        rebuild to the content the version was cut with
 *                        (never answered with other content)
 */
export { EditorProjectRefusal, refuse }

/** What the database functions raise, by name (`RAISE EXCEPTION '<name>'`), and how each is answered. */
const RAISED: Readonly<Record<string, number>> = {
  not_found: 404,
  not_holder: 409,
  base_mismatch: 409,
  invalid_holder: 400,
  invalid_content: 400,
}

/** The refusal `err` stands for, or null when it is a server failure. */
export function refusalOf(err: unknown): EditorProjectRefusal | null {
  if (err instanceof EditorProjectRefusal) return err
  if (typeof err !== "object" || err === null) return null
  const record = err as { code?: unknown; message?: unknown }
  const code = typeof record.code === "string" ? record.code : null
  if (isMissingTableError({ code }) || isMissingFunctionError(err)) return refuse(503, "not_available")
  if (code === "P0001" && typeof record.message === "string" && Object.hasOwn(RAISED, record.message)) {
    return refuse(RAISED[record.message]!, record.message)
  }
  return null
}

/** Answers `err`: its refusal, or a sanitized 500 that logs it. */
export function sendEditorProjectError(reply: FastifyReply, req: FastifyRequest, err: unknown, clientMessage: string) {
  const refusal = refusalOf(err)
  if (refusal) {
    if (refusal.status >= 500) req.log.error({ code: refusal.code }, `[editor-projects] ${clientMessage}`)
    // Busy is a moment's wait (one heavy request per user, or no free worker).
    if (refusal.code === "busy") reply.header("retry-after", "1")
    return reply.status(refusal.status).send({ error: refusal.code })
  }
  return sendInternalError(reply, req, err, clientMessage)
}

/**
 * `err` as a route may rethrow it: a refusal (or a missing table or function,
 * 503) as it is, anything else as a plain error naming only `what` and its
 * code. A database error on a write carries the failing row in its message and
 * detail (keys, ids, hashes), and the 500 path logs the error it is handed.
 */
export function withoutDetail(err: unknown, what: string): unknown {
  if (refusalOf(err)) return err
  const failure = failureOf(err)
  const named = new Error(`editor projects ${what} failed${failure.code ? ` (${failure.code})` : ""}`)
  named.name = "EditorProjectWriteError"
  return named
}

/**
 * What a log line may say about a failure: its error name and, for a
 * database error, its SQLSTATE or PostgREST code. Never its message, which
 * can quote a key, an id or a row's content.
 */
export function failureOf(err: unknown): { error: string; code?: string } {
  const e = err as { name?: unknown; code?: unknown } | null
  const name = typeof e?.name === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(e.name) ? e.name : "Error"
  const code = typeof e?.code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3}|[a-z_]{1,32})$/.test(e.code) ? e.code : undefined
  return code ? { error: name, code } : { error: name }
}
