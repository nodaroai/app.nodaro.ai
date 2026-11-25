import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { requireAppScope } from "../../lib/scope-prehandler.js"
import { refuse, refusalOf, sendEditorProjectError } from "../lib/editor-projects/errors.js"
import { callerOf, holderOf, projectIdOf, sendValidationError, versionNumber } from "../lib/editor-projects/request.js"
import { readProject, readVersionRecord, type ProjectRow } from "../lib/editor-projects/rows.js"
import type { EditorProjectGates } from "../lib/editor-projects/gates.js"
import { requireRoomFor } from "../lib/editor-projects/storage-ceiling.js"
import { requireStore } from "../lib/editor-projects/store.js"
import {
  CurrentFileUnreadable,
  cutVersion,
  currentFileState,
  readVersionGzip,
  thinVersions,
  type VersionContext,
} from "../lib/editor-projects/version-store.js"
import { OWN_AUTHOR } from "../lib/editor-projects/versions.js"
import { SAVE_RATE_LIMIT, commit } from "./editor-projects-file.js"

/**
 * A video-editor project's labelled versions (Cloud; migration 703). Both
 * routes need the tab that holds the edit claim.
 *
 *   POST /v1/editor-projects/:id/versions            { label, author, holder }
 *        → { number } | { number: null, unchanged: true }
 *        A version of the project's current saved content (404 before its
 *        first save); none when that content is already the newest version's.
 *   POST /v1/editor-projects/:id/versions/:n/restore { holder }
 *        → { revision } | { revision, unchanged: true } | { revision, repaired: true }
 *        Version n's whole content becomes the project's content, through the
 *        normal save (the revision bumps). First, a version of the current
 *        state labelled "Before restore" is cut (unless it is already the
 *        newest version); a restore whose cut fails changes nothing, and one
 *        that finds content saved since it began is refused 409
 *        `base_mismatch`, so the current state is never lost. The project is
 *        thinned only after the restore's save has landed: until then, no
 *        version (version n included) is removed. When the project's own
 *        saved file is missing there is no state to keep: version n is saved
 *        as the repair (`repaired: true`).
 *
 * Reading a version is `GET /:id/file?version=n` (editor-projects.ts).
 */

export const BEFORE_RESTORE_LABEL = "Before restore"

/**
 * The cuts one credential may ask for a minute. A cut reads, verifies and
 * diffs whole projects of up to 8 MB, so it is bounded. The same number is
 * also each user's cuts a minute on this instance, counted together for this
 * route and a save's `x-cut-version` (`gates.ts`). A restore is a save and
 * carries the saves' own limit (`SAVE_RATE_LIMIT`).
 */
export const CUT_RATE_LIMIT = { max: 30, timeWindow: "1 minute" } as const
export const CUT_WINDOW_MS = 60_000

/** A version request body is a label, an author and a holder: far under this. */
const VERSION_BODY_MAX_BYTES = 16 * 1024

const cutBody = z.object({
  label: z.string().trim().min(1).max(120),
  author: z.string().trim().min(1).max(60),
  holder: z.string(),
})
const restoreBody = z.object({ holder: z.string() })
const restoreParams = z.object({ n: versionNumber })

/** The caller's live project that `holder` holds (404 / 409 otherwise). */
async function heldBy(userId: string, projectId: string, holder: string): Promise<ProjectRow> {
  const row = await readProject(userId, projectId)
  if (!row) throw refuse(404, "not_found")
  if (row.holder_id !== holder) throw refuse(409, "not_holder")
  return row
}

type Handler = (req: FastifyRequest, reply: FastifyReply, ctx: VersionContext) => Promise<unknown>

/** Each route holds the user's heavy turn (one heavy request per user at a time on this instance; a second is 429 `busy`). */
function route(gates: EditorProjectGates, failure: string, handler: Handler) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = callerOf(req, reply)
    if (!userId) return reply
    let release: (() => void) | null = null
    try {
      release = gates.heavyTurn(userId)
      const store = requireStore(req.log)
      return await handler(req, reply, { userId, projectId: projectIdOf(req), store, log: req.log })
    } catch (err) {
      return sendEditorProjectError(reply, req, err, failure)
    } finally {
      release?.()
    }
  }
}

export async function editorProjectVersionRoutes(app: FastifyInstance, opts: { gates: EditorProjectGates }) {
  const { gates } = opts
  // An over-limit body answers in the editor-project shape, as on the file routes.
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err.code === "FST_ERR_CTP_BODY_TOO_LARGE") return reply.status(413).send({ error: "too_large" })
    throw err
  })
  const preHandler = requireAppScope("assets:write")
  const cutRoute = { preHandler, bodyLimit: VERSION_BODY_MAX_BYTES, config: { rateLimit: CUT_RATE_LIMIT } }
  const restoreRoute = { preHandler, bodyLimit: VERSION_BODY_MAX_BYTES, config: { rateLimit: SAVE_RATE_LIMIT } }

  app.post("/v1/editor-projects/:id/versions", cutRoute, route(gates, "Failed to cut a version", async (req, reply, ctx) => {
    const body = cutBody.safeParse(req.body)
    if (!body.success) return sendValidationError(reply, body.error)
    const row = await heldBy(ctx.userId, ctx.projectId, holderOf(body.data.holder))
    // The user's cuts a minute, shared with x-cut-version, counted once the holder is checked (a cut
    // answered 404 or 409 uses none): answered as the app's rate limit is.
    const turn = gates.takeCut(ctx.userId)
    if (!turn.ok) {
      return reply
        .status(429)
        .header("retry-after", String(turn.retryAfterSeconds))
        .send({ statusCode: 429, error: { code: "rate_limit_exceeded", message: `Too many requests. Retry in ${turn.retryAfterSeconds}s.` } })
    }
    return cutVersion(ctx, row, body.data.label, body.data.author)
  }))

  app.post("/v1/editor-projects/:id/versions/:n/restore", restoreRoute, route(gates, "Failed to restore a version", async (req, reply, ctx) => {
    const params = restoreParams.safeParse(req.params)
    if (!params.success) return sendValidationError(reply, params.error)
    const body = restoreBody.safeParse(req.body)
    if (!body.success) return sendValidationError(reply, body.error)
    const holder = holderOf(body.data.holder)
    const row = await heldBy(ctx.userId, ctx.projectId, holder)
    if (!row.content_hash) throw refuse(404, "not_found")
    const version = await readVersionRecord(ctx.projectId, params.data.n)
    if (!version) throw refuse(404, "not_found")
    if (version.content_hash === row.content_hash) return { revision: Number(row.revision), unchanged: true }
    // The ceiling on stored bytes, before any heavy work: room for the "Before restore" copy of
    // the saved file and for version n's whole content (about the larger of the two files), less
    // the saved file the restore replaces.
    const savedBytes = row.size_bytes ?? 0
    await requireRoomFor(ctx.userId, Math.max(savedBytes, version.size_bytes))
    // Rebuilt and verified before anything is cut or saved (the gzip of its canonical text).
    const gz = await readVersionGzip(ctx, version)
    // The current state, kept as a version. A failure here fails the restore —
    // except a current file that is missing or unreadable: there is no state
    // to keep, and saving version n is the repair. A repair deletes no file
    // it replaces (`keepReplaced`).
    // Not thinned yet: thinning could remove version n, and the save below may still fail.
    let broken: "absent" | "unverifiable" | null = null
    try {
      const kept = await cutVersion(ctx, row, BEFORE_RESTORE_LABEL, OWN_AUTHOR, { thin: false, hash: row.content_hash, roomChecked: true })
      // Another save landed since the row was read: never overwrite it.
      if ("moved" in kept) throw refuse(409, "base_mismatch")
      // Already the newest version, so the cut read nothing: whether this is a repair too.
      if ("unchanged" in kept) {
        const state = await currentFileState(ctx, row)
        if (state !== "ok") broken = state
      }
    } catch (err) {
      if (err instanceof CurrentFileUnreadable) broken = err.reason
      else if (refusalOf(err)?.code === "file_missing") broken = "unverifiable"
      else throw err
    }
    // The normal save, against the state just kept: content saved since is never overwritten.
    const saved = await commit(
      { userId: ctx.userId, projectId: ctx.projectId, holder, hash: version.content_hash, log: ctx.log },
      ctx.store,
      row,
      gz,
      row.content_hash,
      // A repair never deletes the file it replaces: when it was truly absent
      // there is nothing to delete; when the holder saved the same content again
      // meanwhile (a new, healthy key, fenced only by its hash), it survives.
      { keepReplaced: broken !== null },
    )
    const repaired = broken !== null
    await thinVersions(ctx)
    return repaired ? { revision: saved.revision, repaired: true } : { revision: saved.revision }
  }))
}
