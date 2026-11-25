import type { FastifyBaseLogger, FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { requireAppScope } from "../../lib/scope-prehandler.js"
import { applyUploadPolicies } from "../../lib/upload-policy.js"
import type { EditorProjectsStore } from "../lib/editor-projects/bucket.js"
import { CONTENT_HASH_PATTERN } from "../lib/editor-projects/canonical.js"
import { failureOf, refuse, refusalOf, sendEditorProjectError } from "../lib/editor-projects/errors.js"
import { BASE_HASH_HEADER, CONTENT_HASH_HEADER, CUT_VERSION_HEADER, HOLDER_HEADER } from "../../lib/editor-project-headers.js"
import type { EditorProjectGates } from "../lib/editor-projects/gates.js"
import { canonicalContent, patchedContent } from "../lib/editor-projects/heavy.js"
import { requireRoom, requireRoomFor } from "../lib/editor-projects/storage-ceiling.js"
import { HOLDER_PATTERN, callerOf, projectIdOf } from "../lib/editor-projects/request.js"
import { readProject, saveProject, type ProjectRow } from "../lib/editor-projects/rows.js"
import {
  PATCH_BODY_MAX_BYTES,
  PROJECT_BODY_MAX_BYTES,
  PROJECT_TEXT_MAX_BYTES,
  discardFile,
  isProjectFileKey,
  newFileKey,
  requireStore,
} from "../lib/editor-projects/store.js"
import { cutVersion } from "../lib/editor-projects/version-store.js"
import { OWN_AUTHOR } from "../lib/editor-projects/versions.js"

/**
 * Saving a video-editor project's content: whole (PUT) or as a difference
 * (PATCH, an RFC 6902 JSON Patch against the saved copy). Both bodies are
 * gzip (`content-type: application/gzip`), both name the tab (`x-holder`) and
 * the SHA-256 of the result's canonical text (`x-content-hash`), and both may
 * carry `x-cut-version` (URI-encoded, 1–120 characters): after the save
 * answers 200 (`saved: false` included), a version of the saved content is
 * cut with that label, author "you" (ee/lib/editor-projects/version-store.ts).
 * Both answer `{ revision, saved }`, plus `version` when one was cut; a cut
 * that fails is logged and never fails the save.
 *
 * The order of work is what makes a refusal store nothing, and what keeps a
 * hostile request cheap:
 *   1. headers, and the body limit (PUT 5 MB, PATCH 1 MB, 413 `too_large`);
 *   2. the project and the claim, read BEFORE any heavy work: 404, 409
 *      `not_holder` (PATCH: 409 `base_mismatch` unless `x-base-hash` is the
 *      saved hash); the database re-checks both atomically at step 5;
 *   3. on the heavy-work thread (ee/lib/editor-projects/heavy.ts, under a time
 *      and a memory limit, 422 `too_complex` past either): gunzip, capped (PUT
 *      8 MB, PATCH 5 MB inflated; 413), parse, (the patch's op rules, then the
 *      patch,) canonicalise, hash: 422 `hash_mismatch` unless it is
 *      `x-content-hash`; a canonical text over 8 MB is 413; gzip;
 *   4. the deployment's upload policy (422 `upload_blocked`);
 *   5. content already saved (the same hash) writes nothing. New content is
 *      written to a key no save has used (`<uuid>.json.gz` in the private
 *      bucket); the database records it (re-checking the claim, and for a
 *      PATCH the base, under its row lock) and answers the key it replaced,
 *      which is then deleted. A save it refuses, or one that lost to the same
 *      content, deletes the file it wrote. The row always names a file that
 *      exists.
 *
 * A PATCH takes only add / remove / replace / test, at most 20,000 of them,
 * and at most 2,000 add / remove on an array index (422 `too_complex`)
 * (ee/lib/editor-projects/patch.ts), checked before anything is applied.
 */

const MAX_CUT_LABEL_CHARS = 120

/**
 * The saves one credential may send a minute (the app's per-credential
 * limiter). A save inflates, parses and gzips up to 8 MB, so it is bounded;
 * an editor autosaving every few seconds stays far below it. Tunable.
 */
export const SAVE_RATE_LIMIT = { max: 120, timeWindow: "1 minute" } as const

/** The save headers, each once (a repeated header arrives as an array and is refused). */
const saveHeaders = z.object({
  [HOLDER_HEADER]: z.string().optional(),
  [CONTENT_HASH_HEADER]: z.string().optional(),
  [BASE_HASH_HEADER]: z.string().optional(),
  [CUT_VERSION_HEADER]: z.string().optional(),
})

export interface SaveRequest {
  readonly userId: string
  readonly projectId: string
  readonly holder: string
  readonly hash: string
  readonly log: FastifyBaseLogger
}

function readHeaders(req: FastifyRequest, withBase: boolean): { holder: string; hash: string; baseHash: string | null; cut: string | null } {
  const parsed = saveHeaders.safeParse(req.headers)
  if (!parsed.success) throw refuse(400, "validation_error")
  const headers = parsed.data
  const holder = headers[HOLDER_HEADER]
  if (typeof holder !== "string" || !HOLDER_PATTERN.test(holder)) throw refuse(400, "invalid_holder")
  const hash = headers[CONTENT_HASH_HEADER]
  if (typeof hash !== "string" || !CONTENT_HASH_PATTERN.test(hash)) throw refuse(400, "invalid_content")
  let baseHash: string | null = null
  if (withBase) {
    const base = headers[BASE_HASH_HEADER]
    if (typeof base !== "string" || !CONTENT_HASH_PATTERN.test(base)) throw refuse(400, "invalid_content")
    baseHash = base
  }
  const cut = headers[CUT_VERSION_HEADER]
  return { holder, hash, baseHash, cut: cut === undefined ? null : cutVersionLabel(cut) }
}

/** The version label `x-cut-version` names, URI-decoded and trimmed (as the version POST's): 1 to 120 characters, else 400. */
function cutVersionLabel(value: string): string {
  let label: string
  try {
    label = decodeURIComponent(value).trim()
  } catch {
    throw refuse(400, "validation_error")
  }
  const chars = Array.from(label).length
  if (chars < 1 || chars > MAX_CUT_LABEL_CHARS) throw refuse(400, "validation_error")
  return label
}

function bodyOf(req: FastifyRequest): Buffer {
  if (!Buffer.isBuffer(req.body)) throw refuse(400, "invalid_gzip")
  return req.body
}

/** The caller's live project that this tab holds (404 / 409 otherwise). */
async function heldProject(save: SaveRequest): Promise<ProjectRow> {
  const row = await readProject(save.userId, save.projectId)
  if (!row) throw refuse(404, "not_found")
  if (row.holder_id !== save.holder) throw refuse(409, "not_holder")
  return row
}

async function policeContent(save: SaveRequest, buffer: Buffer): Promise<void> {
  const decision = await applyUploadPolicies({
    kind: "json",
    lane: "editor-project",
    mime: "application/json",
    sizeBytes: buffer.length,
    userId: save.userId,
    buffer,
  })
  if (!decision.allow) throw refuse(422, "upload_blocked")
}

export type Saved = { revision: number; saved: boolean }

/**
 * A save refused as `base_mismatch` (by the route's own check or by the
 * database). A retry of a save that already landed (its answer was lost)
 * finds its own content saved: `saved: false` at the row's revision. Anything
 * else is 409 `base_mismatch`.
 */
async function afterBaseMismatch(save: SaveRequest): Promise<Saved> {
  const row = await readProject(save.userId, save.projectId)
  if (row && row.content_hash === save.hash) return { revision: Number(row.revision), saved: false }
  throw refuse(409, "base_mismatch")
}

/**
 * Step 5: store `gz` (the gzip of the canonical text whose hash is
 * `save.hash`, built on the heavy-work thread) as the project's content.
 * `base` (a PATCH's `x-base-hash`) makes the database refuse the save unless
 * that is still the saved content. Every delete here follows the store's
 * delete rule (ee/lib/editor-projects/store.ts).
 */
/**
 * `keepReplaced`: the file this save replaces is NOT deleted (a restore
 * repairing a project whose current file was missing or unverifiable: the
 * save is fenced by hash, so the key it replaces may be one the holder wrote
 * meanwhile for the same content; any bytes there stay in the private bucket).
 */
export async function commit(
  save: SaveRequest,
  store: EditorProjectsStore,
  row: ProjectRow,
  gz: Buffer,
  base?: string,
  options: { keepReplaced?: boolean } = {},
): Promise<Saved> {
  const { userId, projectId, holder, hash, log } = save
  if (row.content_hash === hash && isProjectFileKey(userId, projectId, row.blob_key)) {
    // A row whose file is gone is never answered "saved". A save of this same
    // content cannot repair it: the database does not repoint a row for the
    // hash it already holds (the same-hash save is a no-op). A whole save of
    // any DIFFERENT content does repair it (it stores a new key), after which
    // this content can be saved again. The page's save loop relies on this:
    // on `file_missing` for a same-content save, it must change the content.
    if (!(await store.exists(row.blob_key))) throw refuse(500, "file_missing")
    // Already saved: nothing is written; the call only refreshes the claim,
    // and only while the row still holds this content (base = this hash).
    try {
      const result = await saveProject({ userId, id: projectId, holder, hash, sizeBytes: row.size_bytes ?? 0, blobKey: row.blob_key, base: hash })
      return { revision: result.revision, saved: false }
    } catch (err) {
      if (refusalOf(err)?.code !== "base_mismatch") throw err
      if (base !== undefined) return afterBaseMismatch(save)
      // A whole save, and the row moved on since it was read: this content is new again.
    }
  }
  const key = newFileKey(userId, projectId)
  // A failed write is a 500 with nothing referenced and nothing replaced.
  await store.put(key, gz)
  let result: { revision: number; saved: boolean; previousBlobKey: string | null }
  try {
    result = await saveProject({ userId, id: projectId, holder, hash, sizeBytes: gz.length, blobKey: key, base })
  } catch (err) {
    const refusal = refusalOf(err)
    if (refusal && NAMED_REFUSALS.has(refusal.code)) {
      // The database refused it by name: no row names the file this request wrote.
      await discardFile(store, key, log, "refused save")
      if (refusal.code === "base_mismatch") return afterBaseMismatch(save)
      throw err
    }
    // An unknown outcome (the call may have committed before its answer was
    // lost): the row says which.
    return afterUnknownOutcome(save, key, err)
  }
  if (!result.saved) {
    // A concurrent save of the same content won; the row names its file, not this one.
    await discardFile(store, key, log, "same content already saved")
    return { revision: result.revision, saved: false }
  }
  if (options.keepReplaced) {
    log.warn({ why: "repair" }, "[editor-projects] a repair keeps the file it replaced: it was missing or unverifiable, or the same content saved again meanwhile")
  } else if (isProjectFileKey(userId, projectId, result.previousBlobKey)) {
    await discardFile(store, result.previousBlobKey, log, "replaced by a save")
  }
  return { revision: result.revision, saved: true }
}

/** The database's refusals by name: each means the save did not happen. */
const NAMED_REFUSALS: ReadonlySet<string> = new Set(["not_found", "not_holder", "base_mismatch", "invalid_content", "invalid_holder", "not_available"])

/**
 * A save whose outcome is unknown: the call may have committed, or may still
 * be running on the server (a reset connection or a gateway timeout does not
 * cancel it; it can be waiting on the row lock behind another save). The
 * file this request wrote is NEVER deleted here — a row may yet name it.
 * The row names this request's key: it landed (200 `saved: true` at the
 * row's revision; the key it replaced is unknown, so that file stays an
 * orphan). Otherwise (another key, or the row cannot be read): the new file
 * stays as an orphan and the request fails.
 */
async function afterUnknownOutcome(save: SaveRequest, key: string, err: unknown): Promise<Saved> {
  let row: ProjectRow | null
  try {
    row = await readProject(save.userId, save.projectId)
  } catch {
    throw err
  }
  if (row?.blob_key === key) return { revision: Number(row.revision), saved: true }
  throw err
}

/**
 * `x-cut-version`: a version of the content this save saved, with that label
 * and author "you", by the same code as POST /:id/versions. `version` is
 * added when one was cut (absent when unchanged, or when another save landed
 * first, so `version` always holds this save's content); a failure is logged
 * by name only and the save's own answer stands. It counts against the
 * user's cuts a minute, shared with the POST: past the limit, or past the
 * stored-bytes ceiling, no version is cut and the save's own answer stands.
 */
async function cutAfterSave(
  save: SaveRequest,
  store: EditorProjectsStore,
  gates: EditorProjectGates,
  label: string | null,
  saved: Saved,
): Promise<Saved & { version?: number }> {
  if (label === null) return saved
  if (!gates.takeCut(save.userId).ok) return saved
  try {
    const row = await readProject(save.userId, save.projectId)
    if (!row) return saved
    // This save's content only: when the project already moved on, nothing is cut.
    const cut = await cutVersion({ userId: save.userId, projectId: save.projectId, store, log: save.log }, row, label, OWN_AUTHOR, { hash: save.hash })
    return cut.number === null ? saved : { ...saved, version: cut.number }
  } catch (err) {
    // Past the stored-bytes ceiling the version is skipped, as past the cut limit.
    if (refusalOf(err)?.code === "project_storage_full") return saved
    save.log.warn(failureOf(err), "[editor-projects] the version a save asked for was not cut; the save stands")
    return saved
  }
}

async function putFile(req: FastifyRequest, userId: string, gates: EditorProjectGates) {
  const store = requireStore(req.log)
  const projectId = projectIdOf(req)
  const { holder, hash, cut } = readHeaders(req, false)
  const save = { userId, projectId, holder, hash, log: req.log }
  return cutAfterSave(save, store, gates, cut, await putContent(req, save, store))
}

async function putContent(req: FastifyRequest, save: SaveRequest, store: EditorProjectsStore): Promise<Saved> {
  const body = bodyOf(req)
  const row = await heldProject(save)
  // The ceiling on stored bytes (none for content already saved: it writes nothing), counting the new
  // file less the one it replaces: before the heavy work by the body's size (the same content's gzip),
  // then exactly, before anything is written.
  const replaced = row.size_bytes ?? 0
  const total = row.content_hash !== save.hash ? await requireRoomFor(save.userId, body.length - replaced) : null
  const { text, gz } = await canonicalContent(body, save.hash)
  requireRoom(total, gz.length - replaced)
  await policeContent(save, text)
  return commit(save, store, row, gz)
}

async function patchFile(req: FastifyRequest, userId: string, gates: EditorProjectGates) {
  const store = requireStore(req.log)
  const projectId = projectIdOf(req)
  const { holder, hash, baseHash, cut } = readHeaders(req, true)
  const save = { userId, projectId, holder, hash, log: req.log }
  return cutAfterSave(save, store, gates, cut, await patchContent(req, save, store, baseHash as string))
}

async function patchContent(req: FastifyRequest, save: SaveRequest, store: EditorProjectsStore, base: string): Promise<Saved> {
  const { userId, projectId, hash } = save
  const body = bodyOf(req)
  const row = await heldProject(save)
  if (!row.content_hash || row.content_hash !== base) return afterBaseMismatch(save)
  const stored = isProjectFileKey(userId, projectId, row.blob_key) ? await store.read(row.blob_key, PROJECT_TEXT_MAX_BYTES) : null
  if (!stored) {
    // The row may have moved on (its old file replaced) since it was read.
    const now = await readProject(userId, projectId)
    if (!now) throw refuse(404, "not_found")
    if (now.content_hash !== base) return afterBaseMismatch(save)
    throw refuse(500, "file_missing")
  }
  // The ceiling on stored bytes (none for content already saved), counting the new file less the one
  // it replaces: before the heavy work only a total already past it is refused (the result's size is
  // not known yet), then exactly, before anything is written.
  const replaced = row.size_bytes ?? 0
  const total = row.content_hash !== hash ? await requireRoomFor(userId, 0) : null
  // The op rules first, then the patch (ee/lib/editor-projects/heavy-jobs.ts).
  const { text, gz } = await patchedContent(body, stored, hash)
  requireRoom(total, gz.length - replaced)
  await policeContent(save, text)
  return commit(save, store, row, gz, base)
}

/**
 * Gzip bodies arrive as a Buffer; an over-limit body is 413 `too_large`. Each
 * save holds the user's heavy turn (`gates`, one heavy request per user at a
 * time on this instance; a second is 429 `busy`).
 */
export async function editorProjectFileRoutes(app: FastifyInstance, opts: { gates: EditorProjectGates }) {
  const { gates } = opts
  app.addContentTypeParser("application/gzip", { parseAs: "buffer" }, (_req, body, done) => done(null, body))
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err.code === "FST_ERR_CTP_BODY_TOO_LARGE") return reply.status(413).send({ error: "too_large" })
    throw err
  })

  const handle = (failure: string, fn: (req: FastifyRequest, userId: string, gates: EditorProjectGates) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = callerOf(req, reply)
      if (!userId) return reply
      let release: (() => void) | null = null
      try {
        release = gates.heavyTurn(userId)
        return await fn(req, userId, gates)
      } catch (err) {
        return sendEditorProjectError(reply, req, err, failure)
      } finally {
        release?.()
      }
    }

  const write = requireAppScope("assets:write")
  const config = { rateLimit: SAVE_RATE_LIMIT }
  app.put("/v1/editor-projects/:id/file", { bodyLimit: PROJECT_BODY_MAX_BYTES, preHandler: write, config }, handle("Failed to save project", putFile))
  app.patch("/v1/editor-projects/:id/file", { bodyLimit: PATCH_BODY_MAX_BYTES, preHandler: write, config }, handle("Failed to save project", patchFile))
}
