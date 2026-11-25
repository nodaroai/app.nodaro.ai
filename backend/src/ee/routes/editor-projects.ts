import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { rateLimitKeyGenerator } from "../../lib/rate-limit-key.js"
import { requireAppScope } from "../../lib/scope-prehandler.js"
import { createEditorProjectGates, type EditorProjectGates } from "../lib/editor-projects/gates.js"
import { failureOf, refuse, sendEditorProjectError } from "../lib/editor-projects/errors.js"
import { EDITOR_PROJECT_EXPOSED_HEADERS, REVISION_HEADER, VERSION_HEADER } from "../../lib/editor-project-headers.js"
import { callerOf, holderOf, projectIdOf, projectName, sendValidationError, versionNumber } from "../lib/editor-projects/request.js"
import {
  claimProject,
  countLiveProjects,
  createProject,
  isHeld,
  listProjects,
  listVersionKeys,
  listVersions,
  readProject,
  readVersionRecord,
  releaseProject,
  renameProject,
  softDeleteProject,
} from "../lib/editor-projects/rows.js"
import { discardFile, isProjectFileKey, requireStore } from "../lib/editor-projects/store.js"
import { discardVersionFiles, readVersionGzip } from "../lib/editor-projects/version-store.js"
import { editorProjectFileRoutes } from "./editor-projects-file.js"
import { CUT_RATE_LIMIT, CUT_WINDOW_MS, editorProjectVersionRoutes } from "./editor-projects-versions.js"

/**
 * Video-editor projects saved to a person's account (Cloud; migration 703).
 * Every route needs a signed-in caller and acts only on the caller's own live
 * projects: another person's project, a deleted one and a malformed id are
 * all 404 `not_found`. Refusals are `{ error: "<code>" }`, mapped in one place
 * (`ee/lib/editor-projects/errors.ts`); a database without the tables yet
 * answers 503 `not_available` on every route.
 *
 *   GET    /v1/editor-projects            ?limit (1–100, default 50) → { projects }
 *   POST   /v1/editor-projects            { name }                   → { id, name, revision }
 *   GET    /v1/editor-projects/:id                                   → { id, name, revision, updated_at, held, versions }
 *          (versions newest first: { number, label, author, created_at, size_bytes, kind })
 *   PATCH  /v1/editor-projects/:id        { name }                   → { id, name }
 *   DELETE /v1/editor-projects/:id                                   → { deleted: true } (its files and its versions' files go too)
 *   POST   /v1/editor-projects/:id/claim  { holder, takeover? }      → { held: true } | 409 held_elsewhere
 *   POST   /v1/editor-projects/:id/release { holder }                → { released }
 *   GET    /v1/editor-projects/:id/file   ?version (a number)        → the saved content's gzip, or version n's whole content
 *   PUT    /v1/editor-projects/:id/file   (editor-projects-file.ts)  → { revision, saved, version? }
 *   PATCH  /v1/editor-projects/:id/file   (editor-projects-file.ts)  → { revision, saved, version? }
 *   POST   /v1/editor-projects/:id/versions, /:id/versions/:n/restore (editor-projects-versions.ts)
 *
 * The one-tab claim: a tab claims the project before it edits; a claim not
 * seen for 90 seconds can be taken by another tab, and `takeover` takes it
 * anyway. Only the holder saves.
 *
 * What one person may cost an instance: a save, a cut, a restore and a
 * version read each hold the user's heavy turn (one at a time per user on
 * this instance, 429 `busy` past it; `gates.ts`); creating is 30 a minute and
 * at most `MAX_LIVE_PROJECTS` live projects (409 `too_many_projects`); file
 * reads are 120 a minute, version reads 60, in buckets of their own.
 */

/** The live projects one person may hold. */
export const MAX_LIVE_PROJECTS = 500
/** Creates one credential may send a minute. */
export const CREATE_RATE_LIMIT = { max: 30, timeWindow: "1 minute" } as const
/** File reads one credential may send a minute: the saved content, and (a bucket of its own) a version, which is rebuilt. */
export const FILE_READ_RATE_LIMIT = { max: 120, timeWindow: "1 minute" } as const
export const VERSION_READ_RATE_LIMIT = { max: 60, timeWindow: "1 minute" } as const

/** Whether a file read asks for a version (`?version=`), whatever its value. */
const readsVersion = (req: FastifyRequest) => typeof req.query === "object" && req.query !== null && "version" in req.query

/** The file read's limit: per credential as the app's limiter keys it, with version reads counted apart. */
const fileReadRateLimit = {
  timeWindow: "1 minute",
  max: (req: FastifyRequest) => (readsVersion(req) ? VERSION_READ_RATE_LIMIT.max : FILE_READ_RATE_LIMIT.max),
  keyGenerator: (req: FastifyRequest) => `${rateLimitKeyGenerator(req)}|${readsVersion(req) ? "version" : "current"}`,
}

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
const nameBody = z.object({ name: projectName })
const claimBody = z.object({ holder: z.string(), takeover: z.boolean().optional() })
const releaseBody = z.object({ holder: z.string() })
/** The file read takes one optional query: the version to read. */
const fileQuery = z.object({ version: versionNumber.optional() }).strict()

type Handler = (req: FastifyRequest, reply: FastifyReply, userId: string) => Promise<unknown>

/**
 * Wraps a handler: the caller first, then the private bucket (none on this
 * deployment: 503 `not_available`, as for a database without the tables),
 * every failure through the one mapping.
 */
function route(failure: string, handler: Handler) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = callerOf(req, reply)
    if (!userId) return reply
    try {
      requireStore(req.log)
      return await handler(req, reply, userId)
    } catch (err) {
      return sendEditorProjectError(reply, req, err, failure)
    }
  }
}

/** `GET /:id/file?version=n`: version n's whole content, rebuilt and verified, holding the user's heavy turn. */
async function readVersionFile(req: FastifyRequest, reply: FastifyReply, userId: string, id: string, number: number, gates: EditorProjectGates) {
  const release = gates.heavyTurn(userId)
  try {
    const row = await readProject(userId, id)
    if (!row || !row.content_hash) throw refuse(404, "not_found")
    const store = requireStore(req.log)
    const version = await readVersionRecord(id, number)
    if (!version) throw refuse(404, "not_found")
    // Rebuilt and verified against the version's hash (on the heavy-work thread): never other content.
    const gz = await readVersionGzip({ userId, projectId: id, store, log: req.log }, version)
    return reply
      .header("content-type", "application/gzip")
      .header(REVISION_HEADER, String(row.revision))
      .header(VERSION_HEADER, String(version.number))
      .header("cache-control", "no-store")
      .header("access-control-expose-headers", EDITOR_PROJECT_EXPOSED_HEADERS.join(", "))
      .send(gz)
  } finally {
    release()
  }
}

export async function editorProjectRoutes(app: FastifyInstance) {
  // This registration's own: one instance of the routes, one set of per-user turns and cut counts.
  const gates: EditorProjectGates = createEditorProjectGates({ max: CUT_RATE_LIMIT.max, windowMs: CUT_WINDOW_MS })
  // OAuth app tokens, as the house pattern scopes a person's files: reads need
  // assets:read, writes assets:write (no-ops for first-party sessions and personal keys).
  const read = { preHandler: requireAppScope("assets:read") }
  const write = { preHandler: requireAppScope("assets:write") }

  app.get("/v1/editor-projects", read, route("Failed to list projects", async (req, reply, userId) => {
    const query = listQuery.safeParse(req.query ?? {})
    if (!query.success) return sendValidationError(reply, query.error)
    return { projects: await listProjects(userId, query.data.limit) }
  }))

  app.post("/v1/editor-projects", { ...write, config: { rateLimit: CREATE_RATE_LIMIT } }, route("Failed to create project", async (req, reply, userId) => {
    const body = nameBody.safeParse(req.body)
    if (!body.success) return sendValidationError(reply, body.error)
    // Counted, then created: two creates at once can pass the count together. Accepted as is: it is
    // a cap on what one person can pin, not a constraint (a database one would need a create function).
    if ((await countLiveProjects(userId)) >= MAX_LIVE_PROJECTS) throw refuse(409, "too_many_projects")
    const row = await createProject(userId, body.data.name)
    return { id: row.id, name: row.name, revision: Number(row.revision) }
  }))

  app.get("/v1/editor-projects/:id", read, route("Failed to read project", async (req, _reply, userId) => {
    const id = projectIdOf(req)
    const row = await readProject(userId, id)
    if (!row) throw refuse(404, "not_found")
    const versions = await listVersions(id)
    return { id: row.id, name: row.name, revision: Number(row.revision), updated_at: row.updated_at, held: isHeld(row), versions }
  }))

  app.patch("/v1/editor-projects/:id", write, route("Failed to rename project", async (req, reply, userId) => {
    const id = projectIdOf(req)
    const body = nameBody.safeParse(req.body)
    if (!body.success) return sendValidationError(reply, body.error)
    const row = await renameProject(userId, id, body.data.name)
    if (!row) throw refuse(404, "not_found")
    return { id: row.id, name: row.name }
  }))

  app.delete("/v1/editor-projects/:id", write, route("Failed to delete project", async (req, _reply, userId) => {
    const id = projectIdOf(req)
    if (!(await readProject(userId, id))) throw refuse(404, "not_found")
    // The keys its version rows name (the rows stay until the project row itself is removed),
    // listed before the soft delete (a failure here changes nothing) and again after it: a cut
    // whose row landed before the soft delete is in the second list, and one whose row lands
    // after it finds the project deleted and removes its own (version-store.ts cutVersion). When
    // the second listing fails, the first one's files still go.
    const listedBefore = await listVersionKeys(id)
    const deleted = await softDeleteProject(userId, id)
    if (!deleted) throw refuse(404, "not_found")
    const listedAfter = await listVersionKeys(id).catch((err: unknown) => {
      req.log.warn(failureOf(err), "[editor-projects] listing version files after a delete failed; the ones listed before it are deleted")
      return [] as string[]
    })
    const versionKeys = [...new Set([...listedBefore, ...listedAfter])]
    const store = requireStore(req.log)
    // The keys its own rows named (the store's delete rule).
    if (isProjectFileKey(userId, id, deleted.blobKey)) await discardFile(store, deleted.blobKey, req.log, "project deleted")
    await discardVersionFiles({ userId, projectId: id, store, log: req.log }, versionKeys)
    return { deleted: true }
  }))

  app.post("/v1/editor-projects/:id/claim", write, route("Failed to claim project", async (req, reply, userId) => {
    const id = projectIdOf(req)
    const body = claimBody.safeParse(req.body)
    if (!body.success) return sendValidationError(reply, body.error)
    const held = await claimProject(userId, id, holderOf(body.data.holder), body.data.takeover === true)
    if (!held) throw refuse(409, "held_elsewhere")
    return { held: true }
  }))

  app.post("/v1/editor-projects/:id/release", write, route("Failed to release project", async (req, reply, userId) => {
    const id = projectIdOf(req)
    const body = releaseBody.safeParse(req.body)
    if (!body.success) return sendValidationError(reply, body.error)
    return { released: await releaseProject(userId, id, holderOf(body.data.holder)) }
  }))

  app.get("/v1/editor-projects/:id/file", { ...read, config: { rateLimit: fileReadRateLimit } }, route("Failed to read project file", async (req, reply, userId) => {
    const id = projectIdOf(req)
    const query = fileQuery.safeParse(req.query ?? {})
    if (!query.success) return sendValidationError(reply, query.error)
    if (query.data.version !== undefined) return readVersionFile(req, reply, userId, id, query.data.version, gates)
    const row = await readProject(userId, id)
    if (!row || !row.content_hash) throw refuse(404, "not_found")
    const store = requireStore(req.log)
    // The file the row names: the bytes always belong to the revision answered.
    let current = row
    let object = isProjectFileKey(userId, id, current.blob_key) ? await store.stream(current.blob_key) : null
    if (!object) {
      // A save may have replaced it since the row was read: read the row once more.
      const again = await readProject(userId, id)
      if (!again || !again.content_hash) throw refuse(404, "not_found")
      if (again.blob_key !== current.blob_key && isProjectFileKey(userId, id, again.blob_key)) {
        current = again
        object = await store.stream(again.blob_key)
      }
    }
    if (!object) throw refuse(500, "file_missing")
    reply
      .header("content-type", "application/gzip")
      .header(REVISION_HEADER, String(current.revision))
      .header("cache-control", "no-store")
      // Read cross-origin by the editor: without this the page cannot see the revision.
      .header("access-control-expose-headers", EDITOR_PROJECT_EXPOSED_HEADERS.join(", "))
    if (object.contentLength !== null) reply.header("content-length", String(object.contentLength))
    return reply.send(object.body)
  }))

  await app.register(editorProjectFileRoutes, { gates })
  await app.register(editorProjectVersionRoutes, { gates })
}
